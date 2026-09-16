import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";

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

export default router;
