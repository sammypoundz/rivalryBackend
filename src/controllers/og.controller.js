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

/** Fetches the contestant's hero photo as a Buffer (null on any failure). */
async function fetchPhoto(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
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

  // The rendered card PNG - absolute URL using this request's host
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const ogImage = `${proto}://${host}/api/og/vote/${id}/image`;

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
<meta property="og:image:type" content="image/png">
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
  ctx.font = "700 21px Poppins, sans-serif";
  let contestTitleShown = contestTitle;
  while (
    ctx.measureText(contestTitleShown).width > 420 &&
    contestTitleShown.length > 4
  ) {
    contestTitleShown = contestTitleShown.slice(0, -2);
  }
  if (contestTitleShown !== contestTitle) contestTitleShown += "…";
  ctx.fillText(contestTitleShown, contestX, 130);

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
  ctx.font = "700 26px Poppins, sans-serif";
  ctx.fillText(`${naira(prize)} grand prize`, winX, 268);

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
  ctx.font = "400 17px Poppins, sans-serif";
  ctx.fillText(
    remaining > 0
      ? `${naira(remaining)} votes to go  ·  ${Math.round(progress)}% there`
      : "Goal reached! 🎉",
    72,
    342,
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
  ctx.font = "800 25px Poppins, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("VOTE FOR ME →", 266, ctaY + 42);
  ctx.textAlign = "left";
  ctx.fillStyle = "#8d8d8d";
  ctx.font = "400 17px Poppins, sans-serif";
  ctx.fillText(`${votes.toLocaleString("en-NG")} votes so far`, 72, ctaY + 100);

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

  // Clip and draw the hero photo in a circle (cover-fit)
  const photoBuf = await fetchPhoto(contestant.heroImage);
  let photoDrawn = false;
  if (photoBuf) {
    try {
      const img = new Image();
      img.src = photoBuf;
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
    } catch {
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

  const png = canvas.toBuffer("image/png");
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(png);
}
