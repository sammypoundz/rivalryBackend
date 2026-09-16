import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { prisma } from "../config/prisma.js";
import { ApiError } from "./error.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new ApiError(401, "Authentication required");

    const payload = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new ApiError(401, "User no longer exists");

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.userId = payload.sub;
    } catch {
      /* anonymous */
    }
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== "admin")
    return next(new ApiError(403, "Admin access required"));
  next();
}
