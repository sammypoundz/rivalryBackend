import sharp from "sharp";

const heroImage =
  "https://firebasestorage.googleapis.com/v0/b/rivalry-fe814.appspot.com/o/hero%2Fratee%2F6aaac651615c6ce5fc66939d.jpg?alt=media&token=53e51959-253b-486f-9b66-f5c4466a113d";

const res = await fetch(heroImage, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    Referer: heroImage,
  },
});
const buf = Buffer.from(await res.arrayBuffer());
console.log("bytes:", buf.length, "ct:", res.headers.get("content-type"));

const { createCanvas, Image, GlobalFonts } = await import("@napi-rs/canvas");
const img = new Image();
img.src = buf;
console.log("img dims:", img.width, "x", img.height);

const canvas = createCanvas(600, 600);
const ctx = canvas.getContext("2d");
ctx.beginPath();
ctx.arc(300, 300, 200, 0, Math.PI * 2);
ctx.clip();
ctx.drawImage(img, 100, 100, 400, 400);
const out = canvas.toBuffer("image/jpeg", 90);
await sharp(out).toFile("og-draw-test.jpg");
console.log("written, jpeg bytes:", out.length);
