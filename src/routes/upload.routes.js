import { Router } from "express";
import { ApiError } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";
import { cloudinary } from "../config/index.js";

const router = Router();

/**
 * POST /api/uploads/image
 * Public. Body: { image: dataUrl }
 * Uploads a base64 image to Cloudinary (folder: rivalry/uploads) and returns
 * its CDN URL. Used for device photos picked during the join flow, before a
 * contestant record exists. Intentionally PUBLIC: the referral signup flow
 * uploads the profile photo BEFORE the new account exists, so there is no
 * auth token yet. The folder is keyed by the verified user id when logged
 * in, or a device fingerprint header for anonymous visitors — the only
 * sensitive thing here is the Cloudinary write, which stays server-side.
 */
router.post("/image", async (req, res, next) => {
  try {
    // Accept a single `image` OR an `images` array so the frontend can batch.
    const raw = Array.isArray(req.body?.images)
      ? req.body.images
      : [req.body?.image].filter(Boolean);

    if (!raw.length) {
      throw new ApiError(400, "A base64 image data URL is required");
    }
    if (raw.length > 10) {
      throw new ApiError(400, "Maximum 10 images per request");
    }
    for (const img of raw) {
      if (!img || typeof img !== "string" || !img.startsWith("data:image/")) {
        throw new ApiError(400, "Each item must be a base64 image data URL");
      }
      if (img.length > 6_000_000)
        throw new ApiError(413, "Image too large (max ~4MB each)");
    }

    const folderKey = req.user?.id || (req.get("x-device-id") ? `guest_${req.get("x-device-id")}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) : "guest");
    const urls = await Promise.all(
    raw.map((img) =>
      cloudinary.uploader.upload(img, {
        folder: `rivalry/uploads/${folderKey}`,
          resource_type: "image",
          transformation: [
            { width: 1200, height: 1200, crop: "limit", quality: "auto" },
          ],
        }),
      ),
    );

    res.status(201).json({
      success: true,
      urls: urls.map((u) => u.secure_url),
      // kept for backwards compatibility with single-image callers
      url: urls[0].secure_url,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
