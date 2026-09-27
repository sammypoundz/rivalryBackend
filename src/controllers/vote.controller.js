import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";

function badgeFor(totalVotes) {
  if (totalVotes >= 4000) return "Diamond";
  if (totalVotes >= 2000) return "Gold";
  if (totalVotes >= 1000) return "Silver";
  return "Rising";
}

// Referral reward: ₦500 unlocks once the referred person's contestant entry
// has earned at least this many votes.
const REFERRAL_MIN_VOTES = 5;
const REFERRAL_REWARD = 500;

/**
 * Best-effort: when a contestant backed by a referral crosses the minimum
 * vote count, flip their referrer's invite to "Qualified" (reward unlocked).
 * Runs after every vote and never fails the vote itself.
 */
async function maybeQualifyReferral(contestant) {
  try {
    if (!contestant.userId) return;
    if ((contestant.votes ?? 0) < REFERRAL_MIN_VOTES) return;
    // Invites are keyed by the REFERRER's id — get it from the referred user
    const user = await prisma.user.findUnique({
      where: { id: contestant.userId },
      select: { referredById: true, fullName: true, email: true, phone: true },
    });
    if (!user?.referredById) return;

    // Ids of invites that belong to this signup: tied to this contest, or
    // not tied to any contest (a plain link share). "Signed up" rows are
    // created by the register controller for the actual referred person.
    const baseWhere = {
      referrerId: user.referredById,
      OR: [{ contestId: contestant.contestId }, { contestId: null }],
    };
    const qualified = await prisma.referralInvite.updateMany({
      where: { ...baseWhere, status: "Signed up" },
      data: { status: "Qualified", reward: REFERRAL_REWARD },
    });

    // The invite may never have been flipped to "Signed up" (e.g. an older
    // row with a non-matching contact). The referredById link on the user is
    // the source of truth — stamp the referred person's name onto a leftover
    // invite and credit it, so the reward never gets lost.
    if (qualified.count === 0) {
      const leftover = await prisma.referralInvite.findFirst({
        where: { ...baseWhere, status: "Invited" },
        orderBy: { createdAt: "desc" },
      });
      if (leftover) {
        await prisma.referralInvite.update({
          where: { id: leftover.id },
          data: {
            status: "Qualified",
            reward: REFERRAL_REWARD,
            name: user.fullName,
            contact: (user.email || user.phone || leftover.contact) ?? leftover.contact,
          },
        });
      } else {
        // No row at all — credit the referral with the real person's name.
        await prisma.referralInvite.create({
          data: {
            referrerId: user.referredById,
            name: user.fullName,
            contact: user.email || user.phone || "signup via link",
            status: "Qualified",
            reward: REFERRAL_REWARD,
            contestId: contestant.contestId,
          },
        });
      }
    }
  } catch {
    /* referral unlock is best-effort — voting must still succeed */
  }
}

/**
 * POST /api/contestants/:id/vote
 * Body: { amount?: number, supporterName?: string }
 * Atomically increments contestant votes + contest total, records the Vote row
 * and upserts the Supporter leaderboard entry.
 */
export async function vote(req, res, next) {
  try {
    const contestantId = req.params.id;
    const amount = Math.max(1, Math.min(1000, Number(req.body.amount) || 1));
    const supporterName = req.body.supporterName || null;
    const userId = req.userId || null;

    const contestant = await prisma.contestant.findUnique({
      where: { id: contestantId },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");
    if (new Date(contestant.votingEndsAt).getTime() < Date.now()) {
      throw new ApiError(400, "Voting has ended for this contestant");
    }

    const [vote, contestantUpdated, supporter] = await prisma.$transaction([
      prisma.vote.create({
        data: {
          contestantId,
          userId,
          supporterName,
          amount,
          reference: req.body.reference || null,
          ipAddress: req.ip,
        },
      }),
      prisma.contestant.update({
        where: { id: contestantId },
        data: { votes: { increment: amount } },
      }),
      prisma.contest.update({
        where: { id: contestant.contestId },
        data: { totalVotes: { increment: amount } },
      }),
      supporterName
        ? prisma.supporter.upsert({
            where: { contestantId_name: { contestantId, name: supporterName } },
            create: {
              contestantId,
              userId,
              name: supporterName,
              initials: supporterName
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase(),
              votes: amount,
            },
            update: { votes: { increment: amount } },
          })
        : prisma.contestant.findUnique({
            where: { id: contestantId },
            select: { id: true }, // no-op — the Vote row was already created above
          }),
    ]);

    // Recompute badge from cumulative supporter votes (re-fetch to be safe)
    let supporterFinal = null;
    if (supporterName) {
      const existing = await prisma.supporter.findUnique({
        where: { contestantId_name: { contestantId, name: supporterName } },
      });
      if (existing) {
        const total = await prisma.vote.aggregate({
          where: { contestantId, supporterName },
          _sum: { amount: true },
        });
        const badge = badgeFor(total._sum.amount || 0);
        supporterFinal = badge === existing.badge
          ? existing
          : await prisma.supporter.update({
              where: { id: existing.id },
              data: { badge },
            });
      }
    }

    // Unlock the referrer's ₦500 once the referred contestant reaches 5 votes
    await maybeQualifyReferral(contestantUpdated);

    res.status(201).json({
      success: true,
      vote: { id: vote.id, amount },
      contestantVotes: contestantUpdated.votes,
      supporter: supporterFinal
        ? {
            name: supporterFinal.name,
            votes: supporterFinal.votes,
            badge: supporterFinal.badge,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
}

export async function listSupporters(req, res, next) {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      throw new ApiError(404, "Contestant not found");
    }
    const supporters = await prisma.supporter.findMany({
      where: { contestantId: req.params.id },
      orderBy: { votes: "desc" },
      take: 20,
    });
    res.json({ success: true, supporters });
  } catch (err) {
    next(err);
  }
}

export async function listVotes(req, res, next) {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      throw new ApiError(404, "Contestant not found");
    }
    const votes = await prisma.vote.findMany({
      where: { contestantId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ success: true, votes });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/votes/recent?contestId=&take=
 * The most recent REAL votes across the app (or one contest) with their
 * contestant — powers the live votes feed on the homepage. Every row is an
 * actual Vote record; nothing is simulated.
 */
export async function listRecentVotes(req, res, next) {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.take) || 30));
    const contestId = String(req.query.contestId || "");
    const where = /^[0-9a-fA-F]{24}$/.test(contestId)
      ? { contestant: { contestId } }
      : {};
    const votes = await prisma.vote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        contestant: {
          select: {
            id: true,
            name: true,
            number: true,
            state: true,
            occupation: true,
            heroImage: true,
            votes: true,
            contestId: true,
          },
        },
      },
    });
    res.json({ success: true, votes });
  } catch (err) {
    next(err);
  }
}
