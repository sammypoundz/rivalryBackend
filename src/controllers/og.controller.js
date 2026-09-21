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

/**
 * GET /api/og/vote/:id
 * Share-link landing page for a contestant's voting profile.
 * - Social crawlers (WhatsApp, X, Facebook, Telegram...) get rich OG meta tags
 *   and a fully-designed 1200x630 preview card (photo, contest name, vote goal,
 *   "VOTE FOR ME" CTA).
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
  const photo = contestant.heroImage || "";
  const progress = Math.min(100, Math.round((votes / Math.max(1, goal)) * 100));

  // ---------- Crawler check ----------
  const ua = req.headers["user-agent"] || "";
  const isCrawler =
    /bot|crawl|spider|slurp|facebookexternalhit|facebot|embed|whatsapp|telegrambot|twitterbot|discordbot|linkedinbot|snapchat|preview/i.test(
      ua,
    );

  // ---------- Shared design tokens (matches the app: black + gold) ----------
  const CSS = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Poppins',system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fff;
      width:1200px;height:630px;overflow:hidden}
    .card{position:relative;width:1200px;height:630px;
      background:radial-gradient(900px 500px at 85% -10%,rgba(212,175,55,.28),transparent 60%),
                 radial-gradient(700px 450px at -5% 110%,rgba(212,175,55,.18),transparent 55%),
                 linear-gradient(145deg,#101010,#0a0a0a 55%,#151005);
      display:flex;align-items:center;padding:0 72px;overflow:hidden}
    .card::before{content:'';position:absolute;inset:14px;border:1px solid rgba(212,175,55,.25);
      border-radius:28px;pointer-events:none}
    .glow{position:absolute;width:520px;height:520px;border-radius:50%;
      background:radial-gradient(circle,rgba(212,175,55,.16),transparent 70%);
      right:60px;top:-90px;pointer-events:none}
    .photo-wrap{position:relative;width:400px;height:400px;flex-shrink:0;margin-right:70px}
    .photo-ring{position:absolute;inset:-12px;border-radius:50%;
      background:conic-gradient(from 140deg,#f0d67c,#9a7b1e,#d4af37,#f0d67c);
      box-shadow:0 24px 70px rgba(212,175,55,.35)}
    .photo-ring::after{content:'';position:absolute;inset:9px;border-radius:50%;background:#0a0a0a}
    .photo{position:absolute;inset:0;border-radius:50%;object-fit:cover;
      border:4px solid #0a0a0a;z-index:2}
    .badge{position:absolute;z-index:3;bottom:6px;left:50%;transform:translateX(-50%);
      background:linear-gradient(135deg,#f0d67c,#d4af37);color:#1a1405;font-weight:800;
      font-size:20px;letter-spacing:2px;padding:10px 26px;border-radius:999px;
      box-shadow:0 10px 30px rgba(212,175,55,.45);white-space:nowrap}
    .content{position:relative;z-index:2;display:flex;flex-direction:column;flex:1;min-width:0}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
    .brand-mark{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;
      background:linear-gradient(135deg,#f0d67c,#9a7b1e);color:#1a1405;font-weight:800;font-size:20px}
    .brand-name{font-size:17px;font-weight:600;letter-spacing:5px;color:#d4af37;text-transform:uppercase}
    .contest{font-size:20px;font-weight:500;color:#9a9a9a;letter-spacing:1px;margin-bottom:10px}
    .contest strong{color:#f0d67c;font-weight:700}
    .name{font-size:62px;font-weight:800;line-height:1.05;letter-spacing:-1px;margin-bottom:14px;
      background:linear-gradient(120deg,#fff 30%,#f0d67c);-webkit-background-clip:text;
      -webkit-text-fill-color:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wants{display:flex;align-items:center;gap:14px;margin-bottom:30px}
    .wants-icon{width:44px;height:44px;border-radius:50%;flex-shrink:0;
      background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.4);
      display:flex;align-items:center;justify-content:center;color:#d4af37;font-size:20px;font-weight:800}
    .wants-text{font-size:24px;color:#bdbdbd;line-height:1.3}
    .wants-text b{color:#fff;font-size:30px}
    .bar{width:100%;max-width:480px;height:10px;border-radius:999px;background:rgba(255,255,255,.08);
      overflow:hidden;margin-bottom:30px}
    .bar-fill{height:100%;border-radius:999px;
      background:linear-gradient(90deg,#9a7b1e,#d4af37 60%,#f0d67c);
      box-shadow:0 0 14px rgba(212,175,55,.6)}
    .cta-row{display:flex;align-items:center;gap:26px}
    .cta{display:inline-flex;align-items:center;gap:14px;background:linear-gradient(135deg,#f0d67c,#d4af37 55%,#9a7b1e);
      color:#1a1405;font-size:27px;font-weight:800;letter-spacing:2.5px;padding:22px 46px;border-radius:999px;
      box-shadow:0 16px 44px rgba(212,175,55,.42);white-space:nowrap}
    .cta .arrow{font-size:24px;font-weight:800}
    .cta-sub{font-size:17px;color:#8d8d8d;letter-spacing:.4px}
    .footer{position:absolute;left:72px;right:72px;bottom:34px;display:flex;
      justify-content:space-between;align-items:center;font-size:14px;color:#6f6f6f;
      letter-spacing:1.5px;text-transform:uppercase}
    .dot{color:#d4af37}
  `;

  // ---------- The designed OG card (seen by crawlers and previews) ----------
  const CARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body>
  <div class="card">
    <div class="glow"></div>
    <div class="photo-wrap">
      <div class="photo-ring"></div>
      ${photo ? `<img class="photo" src="${escape(photo)}" alt="${escape(name)}">` : ""}
      <div class="badge">CONTESTANT</div>
    </div>
    <div class="content">
      <div class="brand">
        <div class="brand-mark">R</div>
        <div class="brand-name">Rivalry</div>
      </div>
      <div class="contest">Contest &mdash; <strong>${escape(contestTitle)}</strong></div>
      <div class="name">${escape(name)}</div>
      <div class="wants">
        <div class="wants-icon">&#127942;</div>
        <div class="wants-text">Wants to win <b>${naira(contestant.prize || goal)}</b> grand prize<br>
          ${remaining > 0 ? `${naira(remaining)} votes to go &middot; ${progress}% there` : "Goal reached!"}</div>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${progress}%"></div></div>
      <div class="cta-row">
        <div class="cta">VOTE FOR ME <span class="arrow">&rarr;</span></div>
        <div class="cta-sub">${votes.toLocaleString("en-NG")} votes so far</div>
      </div>
    </div>
    <div class="footer">
      <span>rivalry <span class="dot">&bull;</span> every vote counts</span>
      <span>voting is live now</span>
    </div>
  </div>
</body></html>`;

  // ---------- OG meta page (crawlers read this; humans get redirected) ----------
  const ogTitle = `Vote ${name} — ${contestTitle} on Rivalry 🏆`;
  const ogDesc = `${name} needs ${remaining.toLocaleString("en-NG")} more votes to win ${contestTitle}. Tap to vote for me — it takes 10 seconds!`;

  const META_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escape(ogTitle)}</title>
<meta property="og:title" content="${escape(ogTitle)}">
<meta property="og:description" content="${escape(ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escape(deepLink)}">
<meta property="og:image" content="${escape(photo)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta property="og:site_name" content="Rivalry">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(ogTitle)}">
<meta name="twitter:description" content="${escape(ogDesc)}">
<meta name="twitter:image" content="${escape(photo)}">
<meta http-equiv="refresh" content="0;url=${escape(deepLink)}">
<script>setTimeout(function(){window.location.replace(${JSON.stringify(deepLink)})},50);</script>
</head>
<body>${CARD_HTML}</body></html>`;

  res.set("Cache-Control", "public, max-age=300");
  if (isCrawler) {
    return res.status(200).type("html").send(CARD_HTML);
  }
  return res.status(200).type("html").send(META_HTML);
}
