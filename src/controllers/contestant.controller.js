import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";
import { cloudinary } from "../config/index.js";

/**
 * Uploads a base64 data URL to Cloudinary under the contestant's gallery
 * folder. Returns the secure URL, or null when Cloudinary isn't configured
 * (dev fallback — the raw data URL is stored instead).
 */
async function uploadToCloudinary(dataUrl, contestantId) {
  const configured =
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET;
  if (!configured) return null;

  const res = await cloudinary.uploader.upload(dataUrl, {
    folder: `rivalry/galleries/${contestantId}`,
    resource_type: "image",
    transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto" }],
  });
  return res.secure_url;
}

/** Extracts the Cloudinary public id from a secure URL (best effort). */
function publicIdFromUrl(url) {
  const marker = "/rivalry/galleries/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + 1); // keep "rivalry/galleries/..."
  return path.replace(/\.[a-zA-Z0-9]+$/, ""); // strip extension
}

export async function listByContest(req, res, next) {
  try {
    const contestants = await prisma.contestant.findMany({
      where: { contestId: req.params.contestId },
      orderBy: { votes: "desc" },
      include: { _count: { select: { votes: true, supporters: true } } },
    });
    res.json({ success: true, contestants });
  } catch (err) {
    next(err);
  }
}

export async function getContestant(req, res, next) {
  try {
    const contestant = await prisma.contestant.findUnique({
      where: { id: req.params.id },
      include: { contest: true, supporters: { orderBy: { votes: "desc" }, take: 10 } },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");
    // "Liked by me" must match how the like was stored: userId when logged
    // in, device fingerprint for guests (falls back to IP). A like can live in
    // the contestant-level Like store (hero heart) OR the per-image ImageLike
    // store (tapped on the contestant's image) — the heart lights up for both.
    const fingerprint =
      req.body?.deviceId || req.headers["x-device-id"] || "";
    const voterKey =
      req.userId || (fingerprint ? `fp:${fingerprint}` : `ip:${req.ip}`);
    const [likedByMe, heroImageLike] = await Promise.all([
      prisma.like.findUnique({
        where: { contestantId_voterKey: { contestantId: contestant.id, voterKey } },
      }),
      prisma.imageLike.findFirst({
        where: {
          contestantId: contestant.id,
          image: contestant.heroImage,
          likerKey: voterKey,
        },
        select: { id: true },
      }),
    ]);
    res.json({
      success: true,
      contestant,
      likedByMe: Boolean(likedByMe || heroImageLike),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contestants/:id/like
 * Toggles the caller's like (guests are keyed by IP). Returns the new state.
 */
export async function toggleLike(req, res, next) {
  try {
    const contestantId = req.params.id;
    if (!/^[0-9a-fA-F]{24}$/.test(contestantId)) {
      throw new ApiError(404, "Contestant not found");
    }
    // Fetch the hero image so we can also check the per-image ImageLike store
    // — a like on the contestant's image lives there, not in the Like store.
    const contestant = await prisma.contestant.findUnique({
      where: { id: contestantId },
      select: { heroImage: true },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");

    // Logged-in users key by userId; guests by device fingerprint (header),
    // falling back to IP when no fingerprint was sent.
    const fingerprint =
      req.body?.deviceId || req.headers["x-device-id"] || "";
    const voterKey =
      req.userId || (fingerprint ? `fp:${fingerprint}` : `ip:${req.ip}`);

    const [existing, existingImageLike] = await Promise.all([
      prisma.like.findUnique({
        where: { contestantId_voterKey: { contestantId, voterKey } },
      }),
      prisma.imageLike.findFirst({
        where: {
          contestantId,
          image: contestant.heroImage,
          likerKey: voterKey,
        },
        select: { id: true },
      }),
    ]);

    if (existing || existingImageLike) {
      // Unlike: clear whichever store(s) hold the like (could be both).
      let removed = 0;
      if (existing) {
        await prisma.like.delete({ where: { id: existing.id } });
        removed++;
      }
      if (existingImageLike) {
        await prisma.imageLike.delete({ where: { id: existingImageLike.id } });
        removed++;
      }
      const updated = await prisma.contestant.update({
        where: { id: contestantId },
        data: { likes: { decrement: removed } },
      });
      return res.json({
        success: true,
        liked: false,
        likes: Math.max(0, updated.likes),
      });
    }

    await prisma.like.create({ data: { contestantId, voterKey } });
    const updated = await prisma.contestant.update({
      where: { id: contestantId },
      data: { likes: { increment: 1 } },
    });
    res.json({ success: true, liked: true, likes: updated.likes });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contestants/:id/gallery/like
 * POST /api/contestants/:id/hero/like
 * Toggle a like on ONE image of a contestant. Works for guests via a device
 * fingerprint (body/headers x-device-id) or IP fallback. Tapping again
 * unlikes. Per-image likes accumulate onto the contestant's total `likes`.
 */
export async function likeImage(req, res, next) {
  try {
    const contestantId = req.params.id;
    if (!/^[0-9a-fA-F]{24}$/.test(contestantId)) {
      throw new ApiError(404, "Contestant not found");
    }
    const { image } = req.body;
    if (!image || typeof image !== "string") {
      throw new ApiError(400, "image is required");
    }

    const contestant = await prisma.contestant.findUnique({
      where: { id: contestantId },
      select: { heroImage: true, gallery: true },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");
    // Only likes on images that actually belong to this contestant count.
    if (image !== contestant.heroImage && !contestant.gallery.includes(image)) {
      throw new ApiError(400, "Image does not belong to this contestant");
    }

    const fingerprint =
      req.body?.deviceId || req.headers["x-device-id"] || "";
    const likerKey =
      req.userId || (fingerprint ? `fp:${fingerprint}` : `ip:${req.ip}`);

    // Toggle: like if not liked, unlike if already liked.
    const existing = await prisma.imageLike.findUnique({
      where: {
        contestantId_image_likerKey: { contestantId, image, likerKey },
      },
    });
    let liked;
    if (existing) {
      await prisma.imageLike.delete({ where: { id: existing.id } });
      liked = false;
    } else {
      await prisma.imageLike.create({ data: { contestantId, image, likerKey } });
      liked = true;
    }

    // Count distinct likers for this image.
    const imageLikes = await prisma.imageLike.count({
      where: { contestantId, image },
    });

    // Recompute the contestant's total likes: profile likes + all image likes.
    const profileLikes = await prisma.like.count({ where: { contestantId } });
    const allImageLikes = await prisma.imageLike.count({ where: { contestantId } });
    await prisma.contestant.update({
      where: { id: contestantId },
      data: { likes: profileLikes + allImageLikes },
    });

    res.json({
      success: true,
      liked,
      imageLikes,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contestants/:id/gallery/likes
 * Bulk-lookup: which images (hero + gallery) has THIS viewer already liked,
 * and how many likes each has. Body: { images: string[] }.
 */
export async function imageLikesForViewer(req, res, next) {
  try {
    const contestantId = req.params.id;
    if (!/^[0-9a-fA-F]{24}$/.test(contestantId)) {
      throw new ApiError(404, "Contestant not found");
    }
    const images = Array.isArray(req.body?.images)
      ? req.body.images.filter((u) => typeof u === "string")
      : [];
    if (images.length === 0) {
      return res.json({ success: true, likedImages: [], counts: {} });
    }

    const fingerprint =
      req.body?.deviceId || req.headers["x-device-id"] || "";
    const likerKey =
      req.userId || (fingerprint ? `fp:${fingerprint}` : `ip:${req.ip}`);

    const [mine, counts] = await Promise.all([
      prisma.imageLike.findMany({
        where: { contestantId, image: { in: images }, likerKey },
        select: { image: true },
      }),
      prisma.imageLike.groupBy({
        by: ["image"],
        where: { contestantId, image: { in: images } },
        _count: { _all: true },
      }),
    ]);

    const countMap = {};
    for (const row of counts) countMap[row.image] = row._count._all;

    res.json({
      success: true,
      likedImages: mine.map((m) => m.image),
      counts: countMap,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contestants/:id/gallery
 * Owner only — adds an image (data URL) to the contestant's gallery.
 */
export async function addGalleryImage(req, res, next) {
  try {
    const { image } = req.body;
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      throw new ApiError(400, "A base64 image data URL is required");
    }
    // ~2.5MB after base64 encoding; the JSON body limit is 2mb anyway
    if (image.length > 3_000_000) throw new ApiError(413, "Image too large (max ~2MB)");

    const contestant = await prisma.contestant.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, gallery: true },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");
    if (contestant.userId !== req.user.id) throw new ApiError(403, "Not your contestant");
    if (contestant.gallery.length >= 20) throw new ApiError(400, "Gallery is full (max 20 photos)");
    // Already in the gallery (or it IS the hero photo) — don't store a duplicate
    if (contestant.gallery.includes(image) || contestant.heroImage === image) {
      return res.json({ success: true, gallery: contestant.gallery });
    }

    // Upload to Cloudinary when configured; otherwise store the data URL
    const stored = (await uploadToCloudinary(image, contestant.id)) || image;

    const updated = await prisma.contestant.update({
      where: { id: contestant.id },
      data: { gallery: { push: stored } },
    });
    res.status(201).json({ success: true, gallery: updated.gallery });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/contestants/:id/gallery
 * Owner only — removes one image from the gallery by its data URL.
 */
export async function removeGalleryImage(req, res, next) {
  try {
    const { image } = req.body;
    if (!image || typeof image !== "string") throw new ApiError(400, "image is required");

    const contestant = await prisma.contestant.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, gallery: true },
    });
    if (!contestant) throw new ApiError(404, "Contestant not found");
    if (contestant.userId !== req.user.id) throw new ApiError(403, "Not your contestant");

    const idx = contestant.gallery.indexOf(image);
    if (idx === -1) throw new ApiError(404, "Image not found in gallery");
    const next_ = [...contestant.gallery];
    next_.splice(idx, 1);

    // Best-effort delete from Cloudinary (ignore failures)
    const publicId = publicIdFromUrl(image);
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch {
        /* already gone or not on cloudinary — still remove from gallery */
      }
    }

    const updated = await prisma.contestant.update({
      where: { id: contestant.id },
      data: { gallery: { set: next_ } },
    });
    res.json({ success: true, gallery: updated.gallery });
  } catch (err) {
    next(err);
  }
}

export async function createContestant(req, res, next) {
  try {
    // contestId comes from the route param when posting to
    // /api/contests/:contestId/contestants, or the body for admin creates
    const contestId = req.params.contestId || req.body.contestId;
    const { number, name, state, age, occupation, bio, heroImage, gallery, voteGoal, votingEndsAt } = req.body;
    if (!contestId || !number || !name || !votingEndsAt) {
      throw new ApiError(400, "contestId, number, name and votingEndsAt are required");
    }
    const contestant = await prisma.contestant.create({
      data: {
        contestId,
        number,
        name,
        state,
        age,
        occupation,
        bio,
        // Only upload raw data URLs — when the hero image is already a hosted
        // URL (e.g. uploaded via /api/uploads/image in the join flow) keep it
        // as-is. Re-uploading a URL makes Cloudinary try to fetch it and 500s.
        heroImage:
          (typeof heroImage === "string" && heroImage.startsWith("data:image/")
            ? await uploadToCloudinary(heroImage, "hero")
            : null) || heroImage,
        // The contestant's own photo belongs in the gallery too — seed the
        // gallery with the hero image (plus any extra uploads), de-duplicated.
        // The public profile filters the hero out of the gallery view so it
        // never renders twice, but MySpace lets the owner manage it.
        gallery: Array.from(new Set([heroImage, ...(gallery || [])])).filter(
          (u) => u,
        ),
        voteGoal,
        votingEndsAt: new Date(votingEndsAt),
        // Link the entrant so /users/me/contestants works for self sign-up
        userId: req.user?.id || undefined,
      },
    });
    res.status(201).json({ success: true, contestant });
  } catch (err) {
    next(err);
  }
}

export async function updateContestant(req, res, next) {
  try {
    const data = { ...req.body };
    if (data.votingEndsAt) data.votingEndsAt = new Date(data.votingEndsAt);
    const contestant = await prisma.contestant.update({ where: { id: req.params.id }, data });
    res.json({ success: true, contestant });
  } catch (err) {
    next(err);
  }
}

export async function deleteContestant(req, res, next) {
  try {
    await prisma.contestant.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Contestant deleted" });
  } catch (err) {
    next(err);
  }
}
