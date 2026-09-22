import { prisma } from "../src/config/prisma.js";
import sharp from "sharp";

const heroImage =
  "https://firebasestorage.googleapis.com/v0/b/rivalry-fe814.appspot.com/o/hero%2Fratee%2F6aaac651615c6ce5fc66939d.jpg?alt=media&token=53e51959-253b-486f-9b66-f5c4466a113d";

const ref = await fetch(heroImage, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    Referer: "https://rivalry.vercel.app/",
  },
});
console.log("status:", ref.status, ref.headers.get("content-type"));
const ab = Buffer.from(await ref.arrayBuffer());
console.log("bytes:", ab.length);
const meta = await sharp(ab).metadata();
console.log("dims:", meta.width, "x", meta.height, meta.format);

await prisma.$disconnect();
