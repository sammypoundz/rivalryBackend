import { prisma } from "../src/config/prisma.js";

const id = process.argv[2] || "6aaac651615c6ce5fc66939d";
const c = await prisma.contestant.findUnique({ where: { id } });
console.log("heroImage:", c?.heroImage);
console.log("other photos field names:", Object.keys(c || {}));
if (c) {
  for (const [k, v] of Object.entries(c)) {
    if (
      typeof v === "string" &&
      /http|\.jpg|\.png|\.webp|cloudinary|image/i.test(v)
    ) {
      console.log(" ", k, "=", v);
    }
    if (Array.isArray(v))
      console.log(" ", k, "= array:", JSON.stringify(v).slice(0, 300));
  }
}
await prisma.$disconnect();
