// KoboPoint payment gateway client — dynamic virtual accounts.
// Docs: https://app.kobopoint.com — POST /api/v1/virtual-accounts
//
// All three auth headers are required on every call:
//   Authorization: Bearer <secret key>
//   x-business-id: <business id>
//   api-key: <api key>
// Amounts are in NAIRA (1500 = ₦1,500) — never in kobo.

import crypto from "crypto";
import { config } from "../config/index.js";
import { ApiError } from "../middleware/error.js";

const BASE = config.kobopointBaseUrl.replace(/\/$/, "");

function headers() {
  return {
    Authorization: `Bearer ${config.kobopointSecretKey}`,
    "x-business-id": config.kobopointBusinessId,
    "api-key": config.kobopointApiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function assertConfigured() {
  if (
    !config.kobopointSecretKey ||
    !config.kobopointApiKey ||
    !config.kobopointBusinessId
  ) {
    throw new ApiError(
      503,
      "Payments are not configured yet. Set KOBOPOINT_* keys on the server.",
    );
  }
}

/**
 * Create (or idempotently reuse) a DYNAMIC virtual account for one payment.
 * Re-sending the same `externalReference` returns the same account instead
 * of creating a duplicate, so retries are safe.
 *
 * @param {{ name: string, email?: string, phoneNumber?: string,
 *           amount: number, externalReference: string }} opts
 */
export async function createDynamicAccount({
  name,
  email,
  phoneNumber,
  amount,
  externalReference,
}) {
  assertConfigured();
  // KoboPoint requires email + phone when creating the customer inline.
  // Guest voters don't have either, so we derive deterministic stand-ins
  // from the payment reference — they only identify THIS payment attempt.
  const fallbackEmail =
    `votes.${String(externalReference).toLowerCase().replace(/[^a-z0-9]/g, "")}@pay.rivalry.com.ng`;
  const fallbackPhone = "07000000000";
  const res = await fetch(`${BASE}/v1/virtual-accounts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name,
      email: email || fallbackEmail,
      phoneNumber: phoneNumber || fallbackPhone,
      bankCode: config.kobopointBankCodes,
      businessId: config.kobopointBusinessId,
      accountType: "dynamic",
      amount,
      externalReference,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status === 401 ? 502 : res.status,
      body?.message || "Could not generate a payment account right now",
    );
  }
  const account = Array.isArray(body?.bankAccounts)
    ? body.bankAccounts[0]
    : null;
  if (!account?.accountNumber) {
    throw new ApiError(502, "Payment provider returned no bank account");
  }
  return {
    accountNumber: String(account.accountNumber),
    accountName: account.accountName || name,
    bankName: account.bankName || "",
    bankCode: account.bankCode || "",
    reservedAccountId:
      account.Reserved_Account_Id || account.reservedAccountId || "",
    customer_id: body?.customer?.customer_id || "",
  };
}

/** Look up a payment by KoboPoint transaction id or data.reference. */
export async function verifyTransaction(referenceOrTxnId) {
  assertConfigured();
  const res = await fetch(
    `${BASE}/v1/transactions/${encodeURIComponent(referenceOrTxnId)}`,
    { headers: headers() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const t = body?.data || body?.transaction || body;
  return t && typeof t === "object" ? t : null;
}

/**
 * HMAC-SHA256 of the EXACT raw request body, compared timing-safely against
 * the `X-Kobopoint-Signature` header. Always verify against raw bytes —
 * never a re-serialized JSON object.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !config.kobopointSecretKey) return false;
  const expected = crypto
    .createHmac("sha256", config.kobopointSecretKey)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(String(signatureHeader), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
