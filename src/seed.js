import { prisma } from "./config/prisma.js";
import bcrypt from "bcryptjs";

const day = 24 * 3600 * 1000;

// Default cover used whenever a contest has no image (also mirrored on the
// frontend as the `contestCoverFallback` in src/data.ts).
export const defaultContestCover =
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1200&auto=format&fit=crop";

async function main() {
  console.log("🌱 Seeding database...");

  // Wipe EVERYTHING contest-related (this also clears payment intents so no
  // orphaned dynamic accounts reference deleted contestants).
  console.log("  ↺ Clearing all contests and related data…");
  await prisma.paymentIntent.deleteMany();
  await prisma.supporter.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.like.deleteMany();
  await prisma.imageLike.deleteMany();
  await prisma.referralInvite.deleteMany();
  await prisma.contestant.deleteMany();
  await prisma.contest.deleteMany();

  const admin = await prisma.user.upsert({
    where: { email: "admin@rivalry.ng" },
    update: {},
    create: {
      email: "admin@rivalry.ng",
      password: await bcrypt.hash("Admin123!", 10),
      fullName: "Rivalry Admin",
      role: "admin",
    },
  });
  console.log("  ✓ Admin user:", admin.email, "(password: Admin123!)");

  // ---------- The one active contest ----------
  const endsIn14d = new Date(Date.now() + 14 * day);

  const contest = await prisma.contest.create({
    data: {
      title: "Face of Rivalry 2026",
      tagline: "The ultimate crown. One winner takes it all.",
      category: "Pageant",
      coverImage:
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1200&auto=format&fit=crop",
      status: "voting-live",
      endsAt: endsIn14d,
      totalVotes: 0,
      rewards: [
        {
          position: "1st Place",
          amount: 5000000,
          perk: "₦5M cash + brand ambassador deal",
        },
        {
          position: "2nd Place",
          amount: 2000000,
          perk: "₦2M cash + magazine feature",
        },
        {
          position: "3rd Place",
          amount: 1000000,
          perk: "₦1M cash + wardrobe grant",
        },
      ],
      contestants: {
        create: [
          {
            number: 12,
            name: "Amara Okafor",
            state: "Lagos, Nigeria",
            age: 24,
            occupation: "Architect & Model",
            bio: "Amara is a visionary architect turned pageant contestant, passionate about sustainable design and youth empowerment.",
            heroImage:
              "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=1200&auto=format&fit=crop",
            gallery: [
              "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=600&auto=format&fit=crop",
              "https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=600&auto=format&fit=crop",
            ],
            voteGoal: 25000,
            prize: 50000,
            votingEndsAt: endsIn14d,
          },
          {
            number: 7,
            name: "Zainab Bello",
            state: "Abuja, Nigeria",
            age: 22,
            occupation: "Medical Student",
            bio: "Zainab is a final-year medical student who founded a rural health outreach program.",
            heroImage:
              "https://images.unsplash.com/photo-1580489944761-15a19d65495c?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            voteGoal: 25000,
            prize: 50000,
            votingEndsAt: endsIn14d,
          },
          {
            number: 21,
            name: "Tunde Adeyemi",
            state: "Ibadan, Nigeria",
            age: 26,
            occupation: "Tech Founder",
            bio: "Tunde built an ed-tech startup teaching coding to public school students.",
            heroImage:
              "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            voteGoal: 25000,
            prize: 50000,
            votingEndsAt: endsIn14d,
          },
          {
            number: 3,
            name: "Ngozi Eze",
            state: "Enugu, Nigeria",
            age: 23,
            occupation: "Fashion Designer",
            bio: "Ngozi blends Igbo heritage with modern couture, employing over 40 local artisans.",
            heroImage:
              "https://images.unsplash.com/photo-1589156280159-27698a70f29e?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            voteGoal: 25000,
            prize: 50000,
            votingEndsAt: endsIn14d,
          },
          {
            number: 15,
            name: "Chiamaka Obi",
            state: "Port Harcourt, Nigeria",
            age: 25,
            occupation: "Blogger & TV Presenter",
            bio: "Chiamaka hosts a talk show amplifying young Nigerian voices. She's competing to fund media training for girls.",
            heroImage:
              "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            voteGoal: 25000,
            prize: 50000,
            votingEndsAt: endsIn14d,
          },
          {
            number: 9,
            name: "Ifeanyi Nwosu",
            state: "Onitsha, Nigeria",
            age: 27,
            occupation: "Chef & Restaurateur",
            bio: "Ifeanyi runs a farm-to-table restaurant and wants to open a culinary school for street youth.",
            heroImage:
              "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            voteGoal: 25000,
            prize: 50000,
            votingEndsAt: endsIn14d,
          },
        ],
      },
    },
  });

  console.log(
    "  ✓ Contest created:",
    contest.title,
    "(voting-live, ends in 14 days)",
  );
  console.log("✅ Seed complete — 1 active contest");
}

/**
 * Only seed when this file is RUN directly (`npm run seed`), never when it's
 * merely imported — contest.controller.js imports defaultContestCover from
 * here, so without this guard every server boot (incl. every nodemon restart)
 * wiped and reseeded the whole database.
 */
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
