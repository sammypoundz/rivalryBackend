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

export default router;
