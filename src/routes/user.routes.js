import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { deriveStatus, syncStatuses } from "../controllers/contest.controller.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { ApiError } from "../middleware/error.js";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;
const normalizePhone = (phone) => phone.replace(/[\s\-().]/g, "");
// Synthetic values the auth controller stores when a user registered with
// only one identifier (phone-only or email-only accounts).
const isSynthetic = (v) =>
  Boolean(v && (v.endsWith("@phone.rivalry") || v.endsWith("@email.rivalry")));

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  phone: u.phone ?? null,
  fullName: u.fullName,
  avatarUrl: u.avatarUrl,
  role: u.role,
});

/**
 * PATCH /api/users/me
 * Body: { fullName?, email?, phone? }
 * Lets the user edit their contact info. Synthetic placeholder values
 * (phone-only / email-only accounts) are freely replaceable; real values
 * must stay unique across accounts.
 */
router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const { fullName, email, phone } = req.body;
    const data = {};

    if (fullName !== undefined) {
      const name = String(fullName).trim();
      if (name.length < 2) throw new ApiError(400, "Please enter your full name");
      data.fullName = name;
    }

    if (email !== undefined) {
      const value = String(email).trim().toLowerCase();
      if (!value) throw new ApiError(400, "Email cannot be empty");
      if (!EMAIL_RE.test(value)) throw new ApiError(400, "Please enter a valid email address");
      if (value !== req.user.email || isSynthetic(req.user.email)) {
        const conflict = await prisma.user.findFirst({
          where: { email: value, id: { not: req.user.id } },
        });
        if (conflict) throw new ApiError(409, "Email already registered");
      }
      data.email = value;
    }

    if (phone !== undefined) {
      const raw = String(phone).trim();
      if (!raw) throw new ApiError(400, "Phone number cannot be empty");
      if (!PHONE_RE.test(raw)) throw new ApiError(400, "Please enter a valid phone number");
      const value = normalizePhone(raw);
      if (value !== req.user.phone || isSynthetic(req.user.phone)) {
        const conflict = await prisma.user.findFirst({
          where: { phone: value, id: { not: req.user.id } },
        });
        if (conflict) throw new ApiError(409, "Phone number already registered");
      }
      data.phone = value;
    }

    if (!Object.keys(data).length)
      throw new ApiError(400, "Nothing to update");

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
    });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/users/me/organiser-application
 * Any signed-in user (who isn't already an organiser/admin) applies to become
 * an organiser. The application stays "pending" until an admin approves it —
 * approval is what grants the organiser role (contest creation privileges).
 */
router.post("/me/organiser-application", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === "admin" || req.user.role === "organiser") {
      throw new ApiError(409, "You are already an organiser");
    }
    const { fullName, email, phone, reason } = req.body;
    if (!fullName || !email || !phone || !reason)
      throw new ApiError(400, "fullName, email, phone and reason are required");
    if (!EMAIL_RE.test(String(email).trim()))
      throw new ApiError(400, "Please enter a valid email address");

    // One active application per user — re-applying while pending returns the
    // existing one instead of piling up duplicates.
    const existing = await prisma.organizerApplication.findFirst({
      where: { userId: req.user.id, status: "pending" },
    });
    if (existing) {
      return res.json({ success: true, application: existing });
    }

    const application = await prisma.organizerApplication.create({
      data: {
        userId: req.user.id,
        fullName: String(fullName).trim(),
        email: String(email).trim().toLowerCase(),
        phone: String(phone).trim(),
        reason: String(reason).trim(),
      },
    });
    res.status(201).json({ success: true, application });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/me/organiser-application
 * The logged-in user's latest application (null when they never applied).
 * The dashboard uses this to decide which gate to show: apply form,
 * "under review" notice, or (after approval) the organiser tools.
 */
router.get("/me/organiser-application", requireAuth, async (req, res, next) => {
  try {
    const application = await prisma.organizerApplication.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, application: application ?? null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/me/organised-contests
 * Contests the logged-in organiser (or admin) created, with roster counts —
 * powers the organiser dashboard list.
 */
router.get("/me/organised-contests", requireAuth, async (req, res, next) => {
  try {
    await syncStatuses();
    const where =
      req.user.role === "admin" ? {} : { organiserId: req.user.id };
    const contests = await prisma.contest.findMany({
      where,
      include: { contestants: { orderBy: { votes: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      success: true,
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
        rewards: c.rewards,
        contestantCount: c.contestants.length,
        contestants: c.contestants.slice(0, 8).map((ct) => ({
          id: ct.id,
          name: ct.name,
          number: ct.number,
          heroImage: ct.heroImage,
          votes: ct.votes,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/me/contestants
 * The logged-in user's contestant profiles, with their contest and gallery —
 * i.e. the contests they have entered.
 */
router.get("/me/contestants", requireAuth, async (req, res, next) => {
  try {
    const contestants = await prisma.contestant.findMany({
      where: { userId: req.user.id },
      include: { contest: true },
      orderBy: { number: "asc" },
    });
    res.json({ success: true, contestants });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/me/stats
 * Aggregate totals across all of the user's contestant entries:
 * votes received, likes received, photos uploaded and contests joined.
 */
router.get("/me/stats", requireAuth, async (req, res, next) => {
  try {
    const contestants = await prisma.contestant.findMany({
      where: { userId: req.user.id },
      select: { votes: true, likes: true, gallery: true },
    });
    res.json({
      success: true,
      stats: {
        contestsJoined: contestants.length,
        totalVotes: contestants.reduce((sum, c) => sum + (c.votes || 0), 0),
        totalLikes: contestants.reduce((sum, c) => sum + (c.likes || 0), 0),
        totalPhotos: contestants.reduce((sum, c) => sum + (c.gallery?.length || 0), 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/me/referrals
 * The logged-in user's referral invites + a running total of referral earnings.
 * Also returns `organiser` revenue so the Wallet can show it in one request:
 * per contest created by the user — votes recorded × votePrice +
 * contestants × entryFee — with a combined total.
 */
router.get("/me/referrals", requireAuth, async (req, res, next) => {
  try {
    const invites = await prisma.referralInvite.findMany({
      where: { referrerId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    // ---- Organiser revenue (revenue generated by contests they created) ----
    const myContests = await prisma.contest.findMany({
      where: { organiserId: req.user.id },
      select: { id: true, title: true, votePrice: true, entryFee: true },
    });
    let organiser = { total: 0, contests: [] };
    if (myContests.length > 0) {
      const ids = myContests.map((c) => c.id);
      const [voteAgg, entryCounts, votesByContestant] = await Promise.all([
        prisma.vote.aggregate({
          where: { contestant: { contestId: { in: ids } } },
          _sum: { amount: true },
        }),
        prisma.contestant.groupBy({
          by: ["contestId"],
          where: { contestId: { in: ids } },
          _count: { _all: true },
        }),
        prisma.vote.groupBy({
          by: ["contestantId"],
          where: { contestant: { contestId: { in: ids } } },
          _sum: { amount: true },
        }),
      ]);
      // Map each vote batch back to its contest.
      const contestants = await prisma.contestant.findMany({
        where: { contestId: { in: ids } },
        select: { id: true, contestId: true },
      });
      const contestOf = new Map(contestants.map((ct) => [ct.id, ct.contestId]));
      const votesPerContest = new Map();
      for (const v of votesByContestant) {
        const cid = contestOf.get(v.contestantId);
        if (cid)
          votesPerContest.set(cid, (votesPerContest.get(cid) ?? 0) + (v._sum.amount ?? 0));
      }
      const entriesPerContest = new Map(
        entryCounts.map((e) => [e.contestId, e._count._all]),
      );
      const contestRows = myContests.map((c) => {
        const votes = votesPerContest.get(c.id) ?? 0;
        const entries = entriesPerContest.get(c.id) ?? 0;
        const amount = votes * c.votePrice + entries * c.entryFee;
        return {
          contestId: c.id,
          title: c.title,
          votes,
          voteRevenue: votes * c.votePrice,
          entryRevenue: entries * c.entryFee,
          amount,
        };
      });
      organiser = {
        total: contestRows.reduce((sum, r) => sum + r.amount, 0),
        contests: contestRows,
      };
      // voteAgg kept for future ledger-level accuracy; not needed per-contest.
      void voteAgg;
    }

    res.json({
      success: true,
      referrals: invites,
      earned: invites.reduce((sum, r) => sum + (r.reward || 0), 0),
      organiser,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/users/me/referrals
 * Body: { name, contact, contestId? }
 * Records an invite the user sent (shown as "Invited" until they sign up
 * through the referrer's link).
 */
router.post("/me/referrals", requireAuth, async (req, res, next) => {
  try {
    const { name, contact, contestId } = req.body;
    if (!name || !contact)
      throw new ApiError(400, "name and contact are required");

    const invite = await prisma.referralInvite.create({
      data: {
        referrerId: req.user.id,
        name: String(name).trim(),
        contact: String(contact).trim(),
        ...(contestId && /^[0-9a-fA-F]{24}$/.test(String(contestId))
          ? { contestId: String(contestId) }
          : {}),
      },
    });
    res.status(201).json({ success: true, referral: invite });
  } catch (err) {
    next(err);
  }
});

export default router;

// ========================================================================
// Admin review of organiser applications (mounted at /api/users)
// ========================================================================

/**
 * GET /api/users/organiser-applications?status=pending
 * Admin-only list of applications, newest first, optionally filtered.
 */
router.get("/organiser-applications", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.query;
    const applications = await prisma.organizerApplication.findMany({
      where: status ? { status: String(status) } : undefined,
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, applications });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/users/organiser-applications/:id/approve
 * Admin approves: application → "approved" and the applicant's account is
 * upgraded to role=organiser — granting contest creation privileges.
 */
router.post(
  "/organiser-applications/:id/approve",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const application = await prisma.organizerApplication.findUnique({
        where: { id: req.params.id },
      });
      if (!application) throw new ApiError(404, "Application not found");
      if (application.status !== "pending")
        throw new ApiError(409, `Application already ${application.status}`);

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
      res.json({ success: true, application: updated });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/users/organiser-applications/:id/reject
 * Admin rejects: application → "rejected". The user can re-apply later
 * (a rejected application doesn't block a new one).
 */
router.post(
  "/organiser-applications/:id/reject",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const application = await prisma.organizerApplication.findUnique({
        where: { id: req.params.id },
      });
      if (!application) throw new ApiError(404, "Application not found");
      if (application.status !== "pending")
        throw new ApiError(409, `Application already ${application.status}`);

      const updated = await prisma.organizerApplication.update({
        where: { id: application.id },
        data: { status: "rejected", reviewedAt: new Date() },
      });
      res.json({ success: true, application: updated });
    } catch (err) {
      next(err);
    }
  },
);
