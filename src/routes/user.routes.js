import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
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
