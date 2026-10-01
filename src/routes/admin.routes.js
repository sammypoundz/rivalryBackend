import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { ApiError } from "../middleware/error.js";
import { syncStatuses } from "../controllers/contest.controller.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const publicUser = (u) => ({
  id: u.id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone ?? null,
  role: u.role,
  createdAt: u.createdAt,
  avatarUrl: u.avatarUrl ?? null,
});

// ------------------------------------------------------------------
// KPI stats — everything the Admin Dashboard top strip needs in one call.
// Mirrors the Year-1 targets: users, organisers, contests, active
// contestants, voters this month, voting/entry volume (₦).
// ------------------------------------------------------------------
router.get("/stats", async (_req, res, next) => {
  try {
    const monthAgo = new Date(Date.now() - 30 * 86400000);
    const [users, organisers, admins, contests, liveContests, contestants, votesTotal, votesThisMonth, voteAgg, pendingApplications] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: "organiser" } }),
        prisma.user.count({ where: { role: "admin" } }),
        prisma.contest.count(),
        prisma.contest.count({ where: { status: "voting-live" } }),
        prisma.contestant.count(),
        prisma.vote.count(),
        prisma.vote.count({ where: { createdAt: { gte: monthAgo } } }),
        prisma.vote.aggregate({
          where: { createdAt: { gte: monthAgo } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.organizerApplication.count({ where: { status: "pending" } }),
      ]);

    // Entry-fee volume: entries × their contest's entryFee (all-time, since
    // contestants carry no createdAt in this schema).
    const paidContests = await prisma.contest.findMany({
      where: { entryFee: { gt: 0 } },
      select: { id: true, entryFee: true, _count: { select: { contestants: true } } },
    });
    const entryVolume = paidContests.reduce(
      (sum, c) => sum + c.entryFee * c._count.contestants,
      0,
    );
    const entriesThisMonth = paidContests.reduce(
      (sum, c) => sum + c._count.contestants,
      0,
    );

    res.json({
      success: true,
      stats: {
        users,
        organisers,
        admins,
        contests,
        liveContests,
        contestants,
        votesTotal,
        votesThisMonth,
        votersThisMonth: voteAgg._count._all,
        votingVolume: voteAgg._sum.amount ?? 0,
        entriesThisMonth,
        entryVolume,
        pendingApplications,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Users directory — optional search + role filter, newest first.
// ------------------------------------------------------------------
router.get("/users", async (req, res, next) => {
  try {
    const query = String(req.query.query ?? "").trim();
    const role = String(req.query.role ?? "");
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.offset) || 0;

    const where = {};
    if (["user", "organiser", "admin"].includes(role)) where.role = role;
    if (query) {
      where.OR = [
        { fullName: { contains: query } },
        { email: { contains: query } },
        { phone: { contains: query } },
      ];
    }
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);
    res.json({
      success: true,
      users: users.map(publicUser),
      total,
      hasMore: skip + users.length < total,
    });
  } catch (err) {
    next(err);
  }
});

// Change a user's role (user / organiser / admin)
router.patch("/users/:id/role", async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!["user", "organiser", "admin"].includes(role))
      throw new ApiError(400, "Invalid role");
    if (req.params.id === req.user.id)
      throw new ApiError(400, "You cannot change your own role");
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
    });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Organiser applications — approve / reject grants the organiser role
// (same logic as /api/users/organiser-applications, mounted here for the
// admin dashboard).
// ------------------------------------------------------------------
router.get("/applications", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const applications = await prisma.organizerApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ success: true, applications });
  } catch (err) {
    next(err);
  }
});

async function reviewApplication(req, res, next, status) {
  try {
    const application = await prisma.organizerApplication.findUnique({
      where: { id: req.params.id },
    });
    if (!application) throw new ApiError(404, "Application not found");
    if (application.status !== "pending")
      throw new ApiError(409, `Application already ${application.status}`);

    if (status === "approved") {
      const [updated] = await prisma.$transaction([
        prisma.organizerApplication.update({
          where: { id: application.id },
          data: { status: "approved", reviewedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: application.userId },
          data: { role: "organiser" },
        }),
      ]);
      return res.json({ success: true, application: updated });
    }
    const updated = await prisma.organizerApplication.update({
      where: { id: application.id },
      data: { status: "rejected", reviewedAt: new Date() },
    });
    res.json({ success: true, application: updated });
  } catch (err) {
    next(err);
  }
}

router.post("/applications/:id/approve", (req, res, next) =>
  reviewApplication(req, res, next, "approved"),
);
router.post("/applications/:id/reject", (req, res, next) =>
  reviewApplication(req, res, next, "rejected"),
);

// ------------------------------------------------------------------
// Contests — moderation list with organiser info, PATCH + DELETE.
// ------------------------------------------------------------------
router.get("/contests", async (req, res, next) => {
  try {
    await syncStatuses();
    const status = String(req.query.status ?? "");
    const take = Math.min(Number(req.query.limit) || 100, 200);
    const skip = Number(req.query.offset) || 0;
    const where = status ? { status } : undefined;
    const [contests, total] = await Promise.all([
      prisma.contest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          organiser: {
            select: { id: true, fullName: true, email: true },
          },
          _count: { select: { contestants: true } },
        },
      }),
      prisma.contest.count({ where }),
    ]);
    res.json({
      success: true,
      total,
      hasMore: skip + contests.length < total,
      contests: contests.map((c) => ({
        id: c.id,
        title: c.title,
        tagline: c.tagline,
        category: c.category,
        coverImage: c.coverImage,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        votePrice: c.votePrice,
        entryFee: c.entryFee,
        totalVotes: c.totalVotes,
        contestantCount: c._count.contestants,
        organiser: c.organiser,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// One contest with everything the admin detail view needs: roster,
// rewards, organiser and revenue-affecting fields.
router.get("/contests/:id", async (req, res, next) => {
  try {
    const contest = await prisma.contest.findUnique({
      where: { id: req.params.id },
      include: {
        organiser: { select: { id: true, fullName: true, email: true } },
        contestants: {
          orderBy: { votes: "desc" },
          select: {
            id: true,
            name: true,
            number: true,
            state: true,
            heroImage: true,
            votes: true,
            likes: true,
          },
        },
      },
    });
    if (!contest) throw new ApiError(404, "Contest not found");
    const voteAgg = await prisma.vote.aggregate({
      where: { contestant: { contestId: contest.id } },
      _sum: { amount: true },
    });
    res.json({
      success: true,
      contest: {
        id: contest.id,
        title: contest.title,
        tagline: contest.tagline,
        category: contest.category,
        coverImage: contest.coverImage,
        status: contest.status,
        startsAt: contest.startsAt,
        endsAt: contest.endsAt,
        votePrice: contest.votePrice,
        entryFee: contest.entryFee,
        totalVotes: contest.totalVotes,
        rewards: contest.rewards,
        organiser: contest.organiser,
        contestantCount: contest.contestants.length,
        contestants: contest.contestants,
        voteRevenue: (voteAgg._sum.amount ?? 0) * (contest.votePrice ?? 0),
        entryRevenue:
          contest.contestants.length * (contest.entryFee ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/contests/:id", async (req, res, next) => {
  try {
    const { title, status, votePrice, entryFee } = req.body;
    const data = {};
    if (title !== undefined) {
      const t = String(title).trim();
      if (!t) throw new ApiError(400, "Title cannot be empty");
      data.title = t;
    }
    if (status !== undefined) {
      if (!["voting-live", "upcoming", "ended"].includes(String(status)))
        throw new ApiError(400, "Invalid status");
      data.status = String(status);
    }
    if (votePrice !== undefined) {
      const v = Number(votePrice);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, "Invalid vote price");
      data.votePrice = v;
    }
    if (entryFee !== undefined) {
      const v = Number(entryFee);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, "Invalid entry fee");
      data.entryFee = v;
    }
    if (!Object.keys(data).length) throw new ApiError(400, "Nothing to update");
    const contest = await prisma.contest.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, contest });
  } catch (err) {
    next(err);
  }
});

router.delete("/contests/:id", async (req, res, next) => {
  try {
    await prisma.contest.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Contest deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
