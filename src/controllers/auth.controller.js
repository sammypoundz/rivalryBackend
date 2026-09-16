import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  phone: u.phone ?? null,
  fullName: u.fullName,
  avatarUrl: u.avatarUrl,
  role: u.role,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts +234..., 0801..., 0801 234 5678, (080) 123-4567, etc. (7-15 digits)
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

export function isEmail(identifier) {
  return EMAIL_RE.test(identifier);
}

export function normalizePhone(phone) {
  return phone.replace(/[\s\-().]/g, "");
}

export async function register(req, res, next) {
  try {
    const { email, phone, password, fullName } = req.body;
    if (!password || !fullName)
      throw new ApiError(400, "password and fullName are required");
    if (password.length < 6)
      throw new ApiError(400, "Password must be at least 6 characters");

    if (!email && !phone)
      throw new ApiError(400, "Either email or phone number is required");

    let normalizedEmail = null;
    let normalizedPhone = null;

    if (email) {
      normalizedEmail = String(email).trim().toLowerCase();
      if (!isEmail(normalizedEmail))
        throw new ApiError(400, "Please enter a valid email address");
    } else {
      const rawPhone = String(phone).trim();
      if (!PHONE_RE.test(rawPhone))
        throw new ApiError(400, "Please enter a valid phone number");
      normalizedPhone = normalizePhone(rawPhone);
    }

    const conflict = await prisma.user.findFirst({
      where: normalizedEmail
        ? { email: normalizedEmail }
        : { phone: normalizedPhone },
    });
    if (conflict)
      throw new ApiError(
        409,
        normalizedEmail ? "Email already registered" : "Phone number already registered",
      );

    const user = await prisma.user.create({
      data: {
        // Prisma/MongoDB requires the unique email field to be non-null.
        // For phone-only accounts we store a synthetic email derived from the phone.
        email: normalizedEmail ?? `${normalizedPhone}@phone.rivalry`,
        // Phone is also unique — email-only accounts get a synthetic value
        phone: normalizedPhone ?? `${normalizedEmail}@email.rivalry`,
        fullName,
        password: await bcrypt.hash(password, 10),
      },
    });
    res
      .status(201)
      .json({ success: true, user: publicUser(user), token: signToken(user) });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, phone, password } = req.body;
    const identifier = email || phone;
    if (!identifier || !password)
      throw new ApiError(400, "email/phone and password are required");

    let user;
    if (isEmail(String(identifier).trim())) {
      user = await prisma.user.findUnique({
        where: { email: String(identifier).trim().toLowerCase() },
      });
    } else {
      if (!PHONE_RE.test(String(identifier).trim()))
        throw new ApiError(401, "Invalid email/phone or password");
      user = await prisma.user.findUnique({
        where: { phone: normalizePhone(String(identifier).trim()) },
      });
    }

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new ApiError(401, "Invalid email/phone or password");
    }
    res.json({ success: true, user: publicUser(user), token: signToken(user) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}
