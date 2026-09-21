import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/error.js";

const router = Router();

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
 */
router.get("/me/referrals", requireAuth, async (req, res, next) => {
  try {
    const invites = await prisma.referralInvite.findMany({
      where: { referrerId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      success: true,
      referrals: invites,
      earned: invites.reduce((sum, r) => sum + (r.reward || 0), 0),
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
