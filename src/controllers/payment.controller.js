// Payment flow for votes via KoboPoint dynamic virtual accounts.
//
// 1. The voting page asks for an account → POST /api/payments/vote-account
//    We create a PaymentIntent and request a dynamic VA from KoboPoint keyed
//    by our own `externalReference` (retry-safe / idempotent).
// 2. The supporter transfers the exact amount to the generated account.
// 3a. KoboPoint POSTs the signed webhook → /api/webhooks/kobopoint
//     (mounted in app.js with express.raw so the signature check sees the
//     exact raw bytes) → we credit the votes.
// 3b. While the supporter waits, the page polls GET /api/payments/:ref/status
//     which also double-checks KoboPoint as a webhook fallback.

import { randomBytes } from "crypto";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";
import {
  createDynamicAccount,
  verifyWebhookSignature,
  verifyTransaction,
} from "../services/kobopoint.js";
import { creditPaidVotes } from "./vote.controller.js";

/** Dynamic accounts stay valid for this long before we stop matching them. */
const INTENT_TTL_MS = 60 * 60 * 1000; // 1 hour

function publicIntent(intent) {
  return {
    reference: intent.reference,
    status: intent.status,
    votes: intent.votes,
    amount: intent.amount,
    accountNumber: intent.accountNumber,
    accountName: intent.accountName,
    bankName: intent.bankName,
    expiresAt: intent.expiresAt,
  };
}

/**
 * POST /api/payments/vote-account
 * Body: { contestantId, votes, supporterName?, payerEmail?, payerPhone? }
 * Generates a dynamic virtual account for exactly (votes × votePrice) naira.
 */
export async function createVoteAccount(req, res, next) {
  try {
    const { contestantId, supporterName, payerEmail, payerPhone } = req.body;
    const votes = Math.max(1, Math.min(1000, Number(req.body.votes) || 1));

    if (!/^[0-9a-fA-F]{24}$/.test(String(contestantId || ""))) {
      throw new ApiError(404, "Contestant not found");
    }
    const contestant = await prisma.contestant.findUnique({
      where: { id: contestantId },
      include: { contest: { select: { votePrice: true } } },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");
    if (new Date(contestant.votingEndsAt).getTime() < Date.now()) {
      throw new ApiError(400, "Voting has ended for this contestant");
    }

    const pricePerVote =
      contestant.contest?.votePrice > 0 ? contestant.contest.votePrice : 100;
    const amount = votes * pricePerVote;

    // Clean up stale intents this viewer left behind, so we don't pile up
    // unused accounts (only ones that were never paid).
    const stale = await prisma.paymentIntent.findMany({
      where: {
        contestantId,
        status: "pending",
        createdAt: { lt: new Date(Date.now() - INTENT_TTL_MS) },
      },
      select: { id: true },
    });
    if (stale.length) {
      await prisma.paymentIntent.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: "expired" },
      });
    }

    // KP-<timestamp36>-<rand> — short, unique, ours.
    const reference = `RP-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;

    const payerName =
      req.user?.fullName || supporterName || "Rivalry Supporter";

    const account = await createDynamicAccount({
      name: payerName,
      email: req.user?.email || payerEmail,
      phoneNumber: req.user?.phone || payerPhone,
      amount,
      externalReference: reference,
    });

    const intent = await prisma.paymentIntent.create({
      data: {
        reference,
        contestantId,
        contestId: contestant.contestId,
        userId: req.userId || null,
        supporterName: supporterName || null,
        votes,
        amount,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankName: account.bankName,
        reservedAccountId: account.reservedAccountId,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });

    res.status(201).json({ success: true, payment: publicIntent(intent) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payments/:reference/verify
 * Manual "I've sent the money" check — actively asks KoboPoint whether the
 * transfer has landed for this reference/account and credits immediately.
 */
export async function verifyPayment(req, res, next) {
  try {
    const intent = await prisma.paymentIntent.findUnique({
      where: { reference: req.params.reference },
    });
    if (!intent) throw new ApiError(404, "Payment not found");

    let settled = false;
    if (intent.status === "pending") {
      // Ask KoboPoint by account number and by our external reference —
      // whichever lookup they support.
      const lookups = [
        intent.accountNumber,
        intent.reference,
        intent.reservedAccountId,
      ].filter(Boolean);
      let txn = null;
      for (const key of lookups) {
        txn = await verifyTransaction(key);
        if (txn) break;
      }
      if (
        txn &&
        String(txn.status || "").toLowerCase() === "success" &&
        Number(txn.amount) >= intent.amount
      ) {
        await settleIntent(intent, txn);
        settled = true;
      }
    }

    const fresh = await prisma.paymentIntent.findUnique({
      where: { reference: intent.reference },
    });
    res.json({
      success: true,
      verified: (fresh?.status ?? intent.status) === "paid",
      payment: publicIntent(fresh ?? intent),
      settled,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payments/:reference/status
 * What the voting page polls while the supporter makes the transfer.
 * Also verifies against KoboPoint directly as a webhook fallback.
 */
export async function paymentStatus(req, res, next) {
  try {
    const intent = await prisma.paymentIntent.findUnique({
      where: { reference: req.params.reference },
    });
    if (!intent) throw new ApiError(404, "Payment not found");

    if (intent.status === "pending" && intent.reservedAccountId) {
      const txn = await verifyTransaction(intent.reservedAccountId);
      if (
        txn &&
        String(txn.status || "").toLowerCase() === "success" &&
        Number(txn.amount) >= intent.amount
      ) {
        await settleIntent(intent, txn);
      }
    }

    const fresh = await prisma.paymentIntent.findUnique({
      where: { reference: intent.reference },
    });
    res.json({
      success: true,
      payment: publicIntent(fresh ?? intent),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Shared fulfilment: mark the intent paid, credit the votes exactly once
 * (the unique `paidReference` + a status guard protect against duplicate
 * webhook deliveries).
 */
async function settleIntent(intent, txn) {
  // Claim the intent first — only one caller wins this race.
  const claimed = await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: "pending" },
    data: {
      status: "paid",
      paidReference: String(txn.reference || txn.transaction_id || ""),
      paidAmount: Number(txn.amount) || intent.amount,
      senderName: txn.customer?.sender_name || null,
      senderBank: txn.customer?.sender_bank || null,
    },
  });
  if (claimed.count === 0) return false; // already settled elsewhere

  try {
    await creditPaidVotes({
      contestantId: intent.contestantId,
      amount: intent.votes,
      supporterName: intent.supporterName,
      userId: intent.userId,
      reference: intent.reference,
    });
  } catch (err) {
    // Votes failed to credit — revert the intent so it can be retried.
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "pending", paidReference: null },
    });
    throw err;
  }
  return true;
}

/**
 * POST /api/webhooks/kobopoint  (mounted with express.raw in app.js)
 * KoboPoint notifies us when a transfer lands. Verify HMAC-SHA256 of the
 * RAW body, dedupe by data.reference, credit the votes, answer 200 fast.
 */
export async function kobopointWebhook(req, res, next) {
  try {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || "");
    if (!verifyWebhookSignature(raw, req.headers["x-kobopoint-signature"])) {
      return res.status(401).send("Invalid signature");
    }
    const payload = JSON.parse(raw.toString("utf8"));
    const { event, data } = payload || {};

    if (event === "payment.success" && data?.status === "success") {
      // Dedupe: same KoboPoint delivery should never credit twice.
      const alreadyHandled = await prisma.paymentIntent.findFirst({
        where: { paidReference: String(data.reference || "") },
        select: { id: true },
      });
      if (!alreadyHandled) {
        const intent = await prisma.paymentIntent.findFirst({
          where: {
            accountNumber: String(data.customer?.account_number || ""),
            status: "pending",
          },
        });
        if (intent && Number(data.amount) >= intent.amount) {
          await settleIntent(intent, data);
        }
      }
    }
    // Always answer 200 quickly so retries aren't triggered.
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
