import { prisma } from "./config/prisma.js";
import bcrypt from "bcryptjs";

const day = 24 * 3600 * 1000;

async function main() {
  console.log("🌱 Seeding database...");

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

  const endsSoon = new Date(
    Date.now() + 2 * day + 7 * 3600 * 1000 + 42 * 60 * 1000,
  );

  const contest1 = await prisma.contest.create({
    data: {
      title: "Face of Rivalry 2025",
      tagline: "The ultimate crown. One winner takes it all.",
      category: "Pageant",
      coverImage:
        "https://images.unsplash.com/photo-1516450360452-931468278214?q=80&w=1200&auto=format&fit=crop",
      status: "voting-live",
      endsAt: endsSoon,
      totalVotes: 67547,
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
            votes: 20487,
            voteGoal: 25000,
            rank: 1,
            prize: 50000,
            votingEndsAt: endsSoon,
          },
          {
            number: 7,
            name: "Zainab Bello",
            state: "Abuja, Nigeria",
            age: 22,
            occupation: "Medical Student",
            bio: "Zainab is a final-year medical student who founded a rural health outreach program.",
            heroImage:
              "https://images.unsplash.com/photo-1580489944761-15a19d654956?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 18320,
            voteGoal: 25000,
            rank: 2,
            prize: 50000,
            votingEndsAt: endsSoon,
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
            votes: 15980,
            voteGoal: 25000,
            rank: 3,
            prize: 50000,
            votingEndsAt: endsSoon,
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
            votes: 12760,
            voteGoal: 25000,
            rank: 4,
            prize: 50000,
            votingEndsAt: endsSoon,
          },
        ],
      },
    },
  });

  // Seed supporters on the first contestant
  const amara = await prisma.contestant.findFirst({
    where: { name: "Amara Okafor" },
  });
  await prisma.supporter.createMany({
    data: [
      {
        contestantId: amara.id,
        name: "Chidi Oke",
        initials: "CO",
        votes: 4200,
        badge: "Diamond",
      },
      {
        contestantId: amara.id,
        name: "Zainab Bello",
        initials: "ZB",
        votes: 3250,
        badge: "Gold",
      },
      {
        contestantId: amara.id,
        name: "Tunde Adeyemi",
        initials: "TA",
        votes: 2100,
        badge: "Gold",
      },
    ],
  });

  console.log("  ✓ Contest:", contest1.title);
  console.log("✅ Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
