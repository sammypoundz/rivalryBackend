import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  // Comma-separated list of allowed frontend origins (dev + prod deploy).
  clientUrls: (process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  cloudinaryCloud: process.env.CLOUDINARY_CLOUD_NAME || "",
  // KoboPoint payment gateway (dynamic virtual accounts for votes)
  kobopointBaseUrl: process.env.KOBOPOINT_BASE_URL || "https://app.kobopoint.com/api",
  kobopointSecretKey: process.env.KOBOPOINT_SECRET_KEY || "",
  kobopointApiKey: process.env.KOBOPOINT_API_KEY || "",
  kobopointBusinessId: process.env.KOBOPOINT_BUSINESS_ID || "",
  kobopointBankCodes: (process.env.KOBOPOINT_BANK_CODES || "100033")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
