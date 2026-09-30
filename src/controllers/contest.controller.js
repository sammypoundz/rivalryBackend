import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";
import { defaultContestCover } from "../seed.js";

/**
 * Auto-derive a contest's status from its timeline when the organiser hasn't
 * pinned it manually:
 * - endsAt in the past        → "ended"
 * - startsAt in the future    → "upcoming"
 * - otherwise (in window)     → "voting-live"
 *
 * The organiser can still override manually — that override is respected until
 * the timeline itself changes again (see updateContest, which recomputes when
 * startsAt/endsAt are edited).
 */
export function deriveStatus(startsAt, endsAt, currentStatus) {
  const now = Date.now();
  if (endsAt && new Date(endsAt).getTime() <= now) return "ended";
  if (startsAt && new Date(startsAt).getTime() > now) return "upcoming";
  return currentStatus === "ended" && startsAt && new Date(startsAt).getTime() > now
    ? "upcoming"
    : "voting-live";
}

/**
 * Reconcile every contest's status against its timeline on each list fetch.
 * Cheap (single updateMany per state) and makes status self-healing without a
 * background cron: as soon as time passes, the next read shows the truth.
 */
async function syncStatuses() {
  const now = new Date();
  await prisma.contest.updateMany({
    where: { endsAt: { lte: now }, status: { not: "ended" } },
    data: { status: "ended" },
  });
  await prisma.contest.updateMany({
    where: {
      startsAt: { gt: now },
      endsAt: { gt: now },
      status: { not: "upcoming" },
    },
    data: { status: "upcoming" },
  });
  await prisma.contest.updateMany({
    where: {
      status: { notIn: ["voting-live"] },
      OR: [
        // No scheduled start → live as soon as it exists until it ends.
        { startsAt: null, endsAt: { gt: now } },
        { startsAt: { lte: now }, endsAt: { gt: now } },
      ],
    },
    data: { status: "voting-live" },
  });
}

export async function listContests(_req, res, next) {
  try {
    await syncStatuses();
    const contests = await prisma.contest.findMany({
      include: { contestants: { orderBy: { votes: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, contests });
  } catch (err) {
    next(err);
  }
}

export async function getContest(req, res, next) {
  try {
    await syncStatuses();
    const contest = await prisma.contest.findUnique({
      where: { id: req.params.id },
      include: { contestants: { orderBy: { votes: "desc" } } },
    });
    if (!contest) throw new ApiError(404, "Contest not found");
    res.json({ success: true, contest });
  } catch (err) {
    next(err);
  }
}

export async function createContest(req, res, next) {
  try {
    const { title, tagline, category, coverImage, status, startsAt, endsAt, rewards, votePrice, entryFee } = req.body;
    if (!title || !endsAt) throw new ApiError(400, "title and endsAt are required");
    // Organisers (role=organiser) can only manage contests they created;
    // admins can create freely.
    const organiserId = req.user.role === "admin" ? undefined : req.user.id;
    const contest = await prisma.contest.create({
      data: {
        title,
        tagline,
        category,
        // coverImage is required in the schema — fall back to the shared
        // default cover so a contest created without an image still persists.
        coverImage: coverImage || defaultContestCover,
        status,
        startsAt: startsAt ? new Date(startsAt) : undefined,
        endsAt: new Date(endsAt),
        rewards,
        // Price per vote in Naira — set by the organiser, clamped to a sane
        // range (₦1–₦100,000) with the ₦100 default when omitted.
        votePrice: Math.max(1, Math.min(100000, Number(votePrice) || 100)),
        // Entry fee in Naira — 0 (or omitted) means the contest is free to enter.
        entryFee: Math.max(0, Math.min(1000000, Number(entryFee) || 0)),
        organiserId,
      },
    });
    res.status(201).json({ success: true, contest });
  } catch (err) {
    next(err);
  }
}

export async function updateContest(req, res, next) {
  try {
    const data = { ...req.body };
    if (data.startsAt) data.startsAt = new Date(data.startsAt);
    if (data.endsAt) data.endsAt = new Date(data.endsAt);
    if (data.votePrice !== undefined)
      data.votePrice = Math.max(1, Math.min(100000, Number(data.votePrice) || 100));
    if (data.entryFee !== undefined)
      data.entryFee = Math.max(0, Math.min(1000000, Number(data.entryFee) || 0));
    // When the organiser edits the timeline (or the status itself), re-derive
    // the status from the new timeline — but only when they didn't explicitly
    // pass a status in the same request, so a manual override always wins.
    if (data.startsAt !== undefined || data.endsAt !== undefined) {
      if (data.status === undefined) {
        const current = await prisma.contest.findUnique({
          where: { id: req.params.id },
          select: { startsAt: true, endsAt: true },
        });
        if (current) {
          data.status = deriveStatus(
            data.startsAt !== undefined ? data.startsAt : current.startsAt,
            data.endsAt !== undefined ? data.endsAt : current.endsAt,
            undefined,
          );
        }
      }
    }
    // Non-admin organisers may only update their OWN contests.
    if (req.user.role !== "admin") {
      const existing = await prisma.contest.findUnique({
        where: { id: req.params.id },
        select: { organiserId: true },
      });
      if (!existing) throw new ApiError(404, "Contest not found");
      if (existing.organiserId !== req.user.id)
        throw new ApiError(403, "You can only edit contests you created");
    }
    const contest = await prisma.contest.update({ where: { id: req.params.id }, data });
    res.json({ success: true, contest });
  } catch (err) {
    next(err);
  }
}

export async function deleteContest(req, res, next) {
  try {
    // Non-admin organisers may only delete their OWN contests.
    if (req.user.role !== "admin") {
      const existing = await prisma.contest.findUnique({
        where: { id: req.params.id },
        select: { organiserId: true },
      });
      if (!existing) throw new ApiError(404, "Contest not found");
      if (existing.organiserId !== req.user.id)
        throw new ApiError(403, "You can only delete contests you created");
    }
    await prisma.contest.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Contest deleted" });
  } catch (err) {
    next(err);
  }
}
