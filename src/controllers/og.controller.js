import { prisma } from "../config/prisma.js";

const escape = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const APP_URL = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")[0]
  .trim();

/** Formats a number as ₦ with thousands separators (e.g. 50000 → ₦50,000). */
const naira = (n) => `₦${Number(n || 0).toLocaleString("en-NG")}`;
/** Font stack for money strings — Noto Sans carries the ₦ glyph, Poppins does not. */
const nairaFont = (weight, px) => `${weight} ${px}px "Noto Sans", Poppins, sans-serif`;
/** Characters that only exist in the Noto Sans symbol subset (not Poppins). */
const SYMBOL_RE = /[₦]/;

/**
 * Draws a string that mixes Poppins-only and Noto-only characters by splitting
 * it into runs per font. @napi-rs/canvas doesn't fall back per glyph — it uses
 * the first family for the whole string and draws .notdef boxes for anything
 * it lacks — so ₦/→ must be drawn in their own fillText calls.
 */
function fillMixedText(ctx, text, x, y, poppinsFont, symbolFont) {
  if (!SYMBOL_RE.test(text)) {
    ctx.font = poppinsFont;
    ctx.fillText(text, x, y);
    return;
  }
  // Split into runs: symbol chars → Noto, everything else → Poppins
  const runs = [];
  let cur = "", curSym = null;
  for (const ch of text) {
    const isSym = SYMBOL_RE.test(ch);
    if (isSym !== curSym && cur) {
      runs.push({ text: cur, sym: curSym });
      cur = "";
    }
    curSym = isSym;
    cur += ch;
  }
  if (cur) runs.push({ text: cur, sym: curSym });

  let cx = x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const run of runs) {
    ctx.font = run.sym ? symbolFont : poppinsFont;
    ctx.fillText(run.text, cx, y);
    cx += ctx.measureText(run.text).width;
  }
  ctx.textAlign = prevAlign;
}

/**
 * Fetches the contestant's hero photo as a Buffer (null on any failure).
 * Sends browser-like headers because many hosts (CDNs, res.cloudinary
 * behind referer checks, etc.) reject bare server-side requests.
 */
async function fetchPhoto(url) {
  if (!url) return null;
  // Allow relative paths by resolving against the app URL
  const target = /^https?:\/\//.test(url)
    ? url
    : `${APP_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  if (!/^https?:\/\//.test(target)) return null;
  try {
    const res = await fetch(target, {
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: target,
      },
    });
    if (!res.ok) {
      console.warn(
        `[og] photo fetch ${res.status} for contestant photo: ${target}`,
      );
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= 100) {
      console.warn(`[og] photo fetch too small (${buf.length}b): ${target}`);
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

/**
 * Encodes the canvas to a compact image that social platforms will accept.
 * WhatsApp silently drops preview images above ~300 KB and X above ~5 MB,
 * so we step down JPEG quality until we fit the budget.
 */
function encodeCard(canvas) {
  for (const q of [92, 82, 70, 55, 40]) {
    const buf = canvas.toBuffer("image/jpeg", q);
    if (buf.length <= 280000) return buf;
  }
  return canvas.toBuffer("image/jpeg", 30);
}

/**
 * Picks the first working photo for the OG card.
 * Tries the hero image, then falls back through the gallery, so a broken
 * hero URL never blanks the card — a real photo of the contestant is the
 * whole point of the preview.
 */
async function firstWorkingPhoto(contestant) {
  const candidates = [contestant.heroImage, ...(contestant.gallery || [])].filter(
    (u) => typeof u === "string" && /^https?:\/\//.test(u),
  );
  for (const url of candidates) {
    const buf = await fetchPhoto(url);
    if (buf) return { url, buf };
  }
  return { url: null, buf: null };
}

/**
 * GET /api/og/vote/:id
 * Share-link landing page for a contestant's voting profile.
 * - Social crawlers get rich OG meta tags; og:image points at the rendered
 *   PNG card (/image) so WhatsApp/X/Facebook show the designed preview.
 * - Real visitors are redirected straight into the app at #/vote/:id.
 */
export async function voteOg(req, res) {
  const { id } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return res.status(404).send("Contestant not found");
  }

  const contestant = await prisma.contestant.findUnique({
    where: { id },
    include: { contest: true },
  });
  if (!contestant) return res.status(404).send("Contestant not found");

  const deepLink = `${APP_URL}/#/vote/${id}`;
  const name = contestant.name || "Contestant";
  const contestTitle = contestant.contest?.title || "Rivalry Contest";
  const goal = contestant.voteGoal || 25000;
  const votes = contestant.votes || 0;
  const remaining = Math.max(0, goal - votes);

  // The rendered card PNG - absolute URL using this request's host AND the
  // same path prefix the crawler used, so the link works both when hit
  // directly on the backend (/api/og/...) and through the frontend proxy
  // (/og/...) without extra Vercel rewrites for the image route.
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const basePath = req.path.replace(/\/image$/, ""); // e.g. /og/vote/:id or /api/og/vote/:id
  const ogImage = `${proto}://${host}${basePath}/image`;

  const ogTitle = `Vote ${name} - ${contestTitle} on Rivalry`;
  const ogDesc = `${name} needs ${remaining.toLocaleString("en-NG")} more votes to win ${contestTitle}. Tap to vote for me - it takes 10 seconds!`;

  const META_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escape(ogTitle)}</title>
<meta property="og:title" content="${escape(ogTitle)}">
<meta property="og:description" content="${escape(ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escape(deepLink)}">
<meta property="og:image" content="${escape(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:site_name" content="Rivalry">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(ogTitle)}">
<meta name="twitter:description" content="${escape(ogDesc)}">
<meta name="twitter:image" content="${escape(ogImage)}">
<meta http-equiv="refresh" content="0;url=${escape(deepLink)}">
<script>setTimeout(function(){window.location.replace(${JSON.stringify(deepLink)})},50);</script>
</head>
<body></body></html>`;

  res.set("Cache-Control", "public, max-age=300");
  return res.status(200).type("html").send(META_HTML);
}

/**
 * GET /api/og/vote/:id/image
 * Renders the designed OG card as a real 1200x630 PNG image — this is what
 * WhatsApp/X/Facebook actually display (they don't render HTML).
 */
export async function voteOgImage(req, res) {
  const { id } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return res.status(404).send("Not found");
  }

  const contestant = await prisma.contestant.findUnique({
    where: { id },
    include: { contest: true },
  });
  if (!contestant) return res.status(404).send("Not found");

  const name = contestant.name || "Contestant";
  const contestTitle = contestant.contest?.title || "Rivalry Contest";
  const goal = contestant.voteGoal || 25000;
  const votes = contestant.votes || 0;
  const remaining = Math.max(0, goal - votes);
  const progress = Math.min(100, (votes / Math.max(1, goal)) * 100);

  // Poppins font (falls back to the default if the fetch fails)
  try {
    const fontRes = await fetch(
      "https://fonts.gstatic.com/s/poppins/v21/pxiEyp8kv8JHgFVrJJfecg.woff2",
      { signal: AbortSignal.timeout(8000) },
    );
    if (fontRes.ok) {
      const { GlobalFonts } = await import("@napi-rs/canvas");
      GlobalFonts.register(
        new Uint8Array(await fontRes.arrayBuffer()),
        "Poppins",
      );
    }
  } catch {
    /* fall back to default font */
  }

  // Noto Sans symbol subset — Poppins lacks the ₦ (naira) and → glyphs, so we
  // register a tiny font containing exactly those characters. Money/arrow
  // strings are drawn with this family; Latin text falls back to Poppins.
  try {
    const symRes = await fetch(
      "https://fonts.gstatic.com/l/font?kit=o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d-1EQT8W7SCE&skey=2b960fe17823056f&v=v42",
      { signal: AbortSignal.timeout(8000) },
    );
    if (symRes.ok) {
      const { GlobalFonts } = await import("@napi-rs/canvas");
      GlobalFonts.register(
        new Uint8Array(await symRes.arrayBuffer()),
        "Noto Sans",
      );
    }
  } catch {
    /* fall back to default font */
  }

  const { createCanvas, Image } = await import("@napi-rs/canvas");
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");

  // ----- Background: layered gold-on-black like the app -----
  const bg = ctx.createLinearGradient(0, 0, 1200, 630);
  bg.addColorStop(0, "#101010");
  bg.addColorStop(0.55, "#0a0a0a");
  bg.addColorStop(1, "#151005");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 630);

  // Top-right gold glow
  const glow = ctx.createRadialGradient(1000, -50, 50, 1000, -50, 500);
  glow.addColorStop(0, "rgba(212,175,55,0.30)");
  glow.addColorStop(1, "rgba(212,175,55,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1200, 630);

  // Bottom-left gold glow
  const glow2 = ctx.createRadialGradient(0, 680, 30, 0, 680, 450);
  glow2.addColorStop(0, "rgba(212,175,55,0.18)");
  glow2.addColorStop(1, "rgba(212,175,55,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, 1200, 630);

  // Inner gold border
  ctx.strokeStyle = "rgba(212,175,55,0.30)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(14, 14, 1172, 602, 26);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";

  // ----- Brand row -----
  const brandGrad = ctx.createLinearGradient(72, 40, 114, 82);
  brandGrad.addColorStop(0, "#f0d67c");
  brandGrad.addColorStop(1, "#9a7b1e");
  ctx.fillStyle = brandGrad;
  ctx.beginPath();
  ctx.roundRect(72, 40, 42, 42, 12);
  ctx.fill();
  ctx.fillStyle = "#1a1405";
  ctx.font = "800 24px Poppins, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("R", 93, 72);

  ctx.fillStyle = "#d4af37";
  ctx.font = "600 18px Poppins, sans-serif";
  ctx.textAlign = "left";
  ctx.letterSpacing = "6px";
  ctx.fillText("RIVALRY", 130, 70);
  ctx.letterSpacing = "0px";

  // ----- Contest name -----
  ctx.fillStyle = "#9a9a9a";
  ctx.font = "500 21px Poppins, sans-serif";
  ctx.fillText("Contest — ", 72, 130);
  const contestX = 72 + ctx.measureText("Contest — ").width;
  ctx.fillStyle = "#f0d67c";
  let contestTitleShown = contestTitle;
  while (
    ctx.measureText(contestTitleShown).width > 420 &&
    contestTitleShown.length > 4
  ) {
    contestTitleShown = contestTitleShown.slice(0, -2);
  }
  if (contestTitleShown !== contestTitle) contestTitleShown += "…";
  fillMixedText(
    ctx,
    contestTitleShown,
    contestX,
    130,
    "700 21px Poppins, sans-serif",
    nairaFont(700, 21),
  );

  // ----- Contestant name (big, white→gold gradient) -----
  const nameGrad = ctx.createLinearGradient(72, 150, 700, 230);
  nameGrad.addColorStop(0, "#ffffff");
  nameGrad.addColorStop(1, "#f0d67c");
  ctx.fillStyle = nameGrad;
  ctx.font = "800 58px Poppins, sans-serif";
  let nameShown = name;
  while (ctx.measureText(nameShown).width > 560 && nameShown.length > 4) {
    nameShown = nameShown.slice(0, -2);
  }
  if (nameShown !== name) nameShown += "…";
  ctx.fillText(nameShown, 72, 212);

  // ----- "Wants to win" line -----
  ctx.fillStyle = "#bdbdbd";
  ctx.font = "400 22px Poppins, sans-serif";
  ctx.fillText("Wants to win", 72, 268);
  const prize = contestant.prize || goal;
  const winX = 72 + ctx.measureText("Wants to win ").width;
  ctx.fillStyle = "#ffffff";
  fillMixedText(
    ctx,
    `${naira(prize)} grand prize`,
    winX,
    268,
    "700 26px Poppins, sans-serif",
    nairaFont(700, 26),
  );

  // ----- Progress bar -----
  const barY = 300;
  const barW = 460;
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.beginPath();
  ctx.roundRect(72, barY, barW, 10, 5);
  ctx.fill();
  if (progress > 0) {
    const barGrad = ctx.createLinearGradient(72, 0, 72 + barW, 0);
    barGrad.addColorStop(0, "#9a7b1e");
    barGrad.addColorStop(0.6, "#d4af37");
    barGrad.addColorStop(1, "#f0d67c");
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(72, barY, Math.max(10, barW * (progress / 100)), 10, 5);
    ctx.fill();
  }
  ctx.fillStyle = "#8d8d8d";
  fillMixedText(
    ctx,
    remaining > 0
      ? `${naira(remaining)} votes to go  ·  ${Math.round(progress)}% there`
      : "Goal reached! 🎉",
    72,
    342,
    "400 17px Poppins, sans-serif",
    nairaFont(400, 17),
  );

  // ----- CTA pill -----
  const ctaY = 380;
  const ctaGrad = ctx.createLinearGradient(72, ctaY, 460, ctaY + 62);
  ctaGrad.addColorStop(0, "#f0d67c");
  ctaGrad.addColorStop(0.55, "#d4af37");
  ctaGrad.addColorStop(1, "#9a7b1e");
  ctx.fillStyle = ctaGrad;
  ctx.beginPath();
  ctx.roundRect(72, ctaY, 388, 62, 31);
  ctx.fill();
  ctx.fillStyle = "#1a1405";
  ctx.textAlign = "center";
  fillMixedText(
    ctx,
    "VOTE FOR ME",
    266 - 12,
    ctaY + 42,
    "800 25px Poppins, sans-serif",
    nairaFont(800, 25),
  );
  // Arrow drawn as a path — no font glyph needed
  ctx.beginPath();
  const ax = 340, ay = ctaY + 31;
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + 14, ay + 10);
  ctx.lineTo(ax, ay + 20);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#8d8d8d";
  fillMixedText(
    ctx,
    `${votes.toLocaleString("en-NG")} votes so far`,
    72,
    ctaY + 100,
    "400 17px Poppins, sans-serif",
    nairaFont(400, 17),
  );

  // ----- Footer -----
  ctx.fillStyle = "#6f6f6f";
  ctx.font = "400 14px Poppins, sans-serif";
  ctx.fillText("RIVALRY · EVERY VOTE COUNTS", 72, 596);
  ctx.textAlign = "right";
  ctx.fillText("VOTING IS LIVE NOW", 1128, 596);
  ctx.textAlign = "left";

  // ----- Circular photo with gold ring (right side) -----
  const cx = 890;
  const cy = 300;
  const r = 175;
  const ring = (() => {
    if (typeof ctx.createConicGradient === "function") {
      const g = ctx.createConicGradient(2.4, cx, cy);
      g.addColorStop(0, "#f0d67c");
      g.addColorStop(0.35, "#9a7b1e");
      g.addColorStop(0.7, "#d4af37");
      g.addColorStop(1, "#f0d67c");
      return g;
    }
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, "#f0d67c");
    g.addColorStop(1, "#9a7b1e");
    return g;
  })();

  // Glow behind the ring
  const ringGlow = ctx.createRadialGradient(cx, cy, r, cx, cy, r + 70);
  ringGlow.addColorStop(0, "rgba(212,175,55,0.35)");
  ringGlow.addColorStop(1, "rgba(212,175,55,0)");
  ctx.fillStyle = ringGlow;
  ctx.fillRect(cx - r - 80, cy - r - 80, (r + 80) * 2, (r + 80) * 2);

  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fill();

  // Clip and draw the hero photo in a circle (cover-fit).
  // Falls back to the gallery if the hero URL is dead, then to a placeholder.
  const { buf: photoBuf } = await firstWorkingPhoto(contestant);
  let photoDrawn = false;
  if (photoBuf) {
    try {
      const img = new Image();
      // @napi-rs/canvas decodes asynchronously — without awaiting decode()
      // drawImage silently paints nothing (the blank-circle bug).
      img.src = photoBuf;
      await img.decode();
      if (!(img.width > 0 && img.height > 0)) {
        throw new Error("decoded image has zero dimensions");
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      ctx.restore();
      photoDrawn = true;
    } catch (err) {
      console.warn(
        `[og] could not draw photo for contestant ${id}:`,
        err instanceof Error ? err.message : err,
      );
      /* draw placeholder below */
    }
  }
  if (!photoDrawn) {
    // Placeholder: gold initial on dark circle
    ctx.fillStyle = "#161616";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d4af37";
    ctx.font = "800 120px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name[0]?.toUpperCase() || "R", cx, cy + 42);
    ctx.textAlign = "left";
  }

  // "CONTESTANT" pill badge under the photo
  ctx.fillStyle = "#d4af37";
  ctx.beginPath();
  ctx.roundRect(cx - 96, cy + r - 14, 192, 40, 20);
  ctx.fill();
  ctx.fillStyle = "#1a1405";
  ctx.font = "800 16px Poppins, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CONTESTANT", cx, cy + r + 12);
  ctx.textAlign = "left";

  const image = encodeCard(canvas);
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(image);
}
