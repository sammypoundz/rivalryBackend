import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";

function badgeFor(totalVotes) {
  if (totalVotes >= 4000) return "Diamond";
  if (totalVotes >= 2000) return "Gold";
  if (totalVotes >= 1000) return "Silver";
  return "Rising";
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
        : prisma.vote.create({ data: { contestantId, userId, amount } }),
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
