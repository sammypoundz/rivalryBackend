import { prisma } from "./config/prisma.js";
import bcrypt from "bcryptjs";

const day = 24 * 3600 * 1000;

// Default cover used whenever a contest has no image (also mirrored on the
// frontend as the `contestCoverFallback` in src/data.ts).
export const defaultContestCover =
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1200&auto=format&fit=crop";

async function main() {
  console.log("🌱 Seeding database...");

  // Idempotent seed: wipe previous demo data so re-running never duplicates.
  console.log("  ↺ Clearing old demo data…");
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

  const endsSoon = new Date(
    Date.now() + 2 * day + 7 * 3600 * 1000 + 42 * 60 * 1000,
  );

  const contest1 = await prisma.contest.create({
    data: {
      title: "Face of Rivalry 2025",
      tagline: "The ultimate crown. One winner takes it all.",
      category: "Pageant",
      coverImage:
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1200&auto=format&fit=crop",
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
            votes: 10130,
            voteGoal: 25000,
            rank: 5,
            prize: 50000,
            votingEndsAt: endsSoon,
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
            votes: 8645,
            voteGoal: 25000,
            rank: 6,
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

  // ---------- Contest 2: Rising Star Challenge (voting live) ----------
  const endsIn9d = new Date(Date.now() + 9 * day);
  const contest2 = await prisma.contest.create({
    data: {
      title: "Rising Star Challenge",
      tagline: "Fresh faces. Fierce competition. Big break.",
      category: "Talent",
      coverImage:
        "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=1200&auto=format&fit=crop",
      status: "voting-live",
      endsAt: endsIn9d,
      totalVotes: 47060,
      rewards: [
        { position: "1st Place", amount: 2500000, perk: "₦2.5M cash + mentorship program" },
        { position: "2nd Place", amount: 1200000, perk: "₦1.2M cash + studio session" },
        { position: "3rd Place", amount: 600000, perk: "₦600K cash + headshot package" },
      ],
      contestants: {
        create: [
          {
            number: 4,
            name: "Kemi Balogun",
            state: "Lagos, Nigeria",
            age: 21,
            occupation: "Afro-soul Singer",
            bio: "Kemi's vocals went viral covering Afrobeats classics. She's recording her first EP with your votes.",
            heroImage:
              "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 15210,
            voteGoal: 25000,
            rank: 1,
            prize: 50000,
            votingEndsAt: endsIn9d,
          },
          {
            number: 18,
            name: "Emeka Duru",
            state: "Aba, Nigeria",
            age: 23,
            occupation: "Dancer & Choreographer",
            bio: "Emeka leads a street-dance crew of 12 and dreams of a national tour.",
            heroImage:
              "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 13355,
            voteGoal: 25000,
            rank: 2,
            prize: 50000,
            votingEndsAt: endsIn9d,
          },
          {
            number: 27,
            name: "Fatima Sule",
            state: "Kano, Nigeria",
            age: 20,
            occupation: "Poet & Spoken Word Artist",
            bio: "Fatima performs in Hausa and English, telling stories of northern womanhood.",
            heroImage:
              "https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 10450,
            voteGoal: 25000,
            rank: 3,
            prize: 50000,
            votingEndsAt: endsIn9d,
          },
          {
            number: 33,
            name: "Seyi Afolabi",
            state: "Abeokuta, Nigeria",
            age: 22,
            occupation: "Comedian & Skit Maker",
            bio: "Seyi's skits have 400k followers. Winning funds his first comedy special.",
            heroImage:
              "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 8045,
            voteGoal: 25000,
            rank: 4,
            prize: 50000,
            votingEndsAt: endsIn9d,
          },
        ],
      },
    },
  });
  console.log("  ✓ Contest:", contest2.title);

  // ---------- Contest 3: Style Icon Awards (upcoming) ----------
  const endsIn16d = new Date(Date.now() + 16 * day);
  const contest3 = await prisma.contest.create({
    data: {
      title: "Style Icon Awards",
      tagline: "Fashion-forward. Tradition-meets-couture showdown.",
      category: "Fashion",
      coverImage:
        "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?q=80&w=1200&auto=format&fit=crop",
      status: "upcoming",
      endsAt: endsIn16d,
      totalVotes: 0,
      rewards: [
        { position: "1st Place", amount: 3000000, perk: "₦3M cash + runway contract" },
        { position: "2nd Place", amount: 1500000, perk: "₦1.5M cash + lookbook shoot" },
      ],
      contestants: {
        create: [
          {
            number: 5,
            name: "Ada Umeh",
            state: "Nnewi, Nigeria",
            age: 24,
            occupation: "Stylist",
            bio: "Ada styles celebrities for red carpets across Africa.",
            heroImage:
              "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 0,
            voteGoal: 25000,
            rank: 0,
            prize: 50000,
            votingEndsAt: endsIn16d,
          },
          {
            number: 11,
            name: "Musa Danjuma",
            state: "Jos, Nigeria",
            age: 26,
            occupation: "Leatherwear Designer",
            bio: "Musa crafts premium leather pieces from Jos hides.",
            heroImage:
              "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 0,
            voteGoal: 25000,
            rank: 0,
            prize: 50000,
            votingEndsAt: endsIn16d,
          },
          {
            number: 22,
            name: "Bisi Adewale",
            state: "Osogbo, Nigeria",
            age: 23,
            occupation: "Textile Artist",
            bio: "Bisi hand-dyes adire textiles for global fashion houses.",
            heroImage:
              "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 0,
            voteGoal: 25000,
            rank: 0,
            prize: 50000,
            votingEndsAt: endsIn16d,
          },
        ],
      },
    },
  });
  console.log("  ✓ Contest:", contest3.title);

  // ---------- Contest 4: Voice of the People (voting live) ----------
  const endsIn5d = new Date(Date.now() + 5 * day);
  const contest4 = await prisma.contest.create({
    data: {
      title: "Voice of the People",
      tagline: "One mic. One message. The crowd decides.",
      category: "Debate",
      coverImage:
        "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?q=80&w=1200&auto=format&fit=crop",
      status: "voting-live",
      endsAt: endsIn5d,
      totalVotes: 21340,
      rewards: [
        { position: "1st Place", amount: 1800000, perk: "₦1.8M cash + media fellowship" },
        { position: "2nd Place", amount: 900000, perk: "₦900K cash + podcast deal" },
      ],
      contestants: {
        create: [
          {
            number: 2,
            name: "Oluwaseun Akin",
            state: "Lagos, Nigeria",
            age: 28,
            occupation: "Policy Analyst",
            bio: "Oluwaseun debates fiscal policy with data-driven clarity.",
            heroImage:
              "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 11750,
            voteGoal: 25000,
            rank: 1,
            prize: 50000,
            votingEndsAt: endsIn5d,
          },
          {
            number: 16,
            name: "Hadiza Yusuf",
            state: "Kaduna, Nigeria",
            age: 25,
            occupation: "Public Health Advocate",
            bio: "Hadiza campaigns for primary healthcare funding in rural states.",
            heroImage:
              "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?q=80&w=1200&auto=format&fit=crop",
            gallery: [],
            votes: 9590,
            voteGoal: 25000,
            rank: 2,
            prize: 50000,
            votingEndsAt: endsIn5d,
          },
        ],
      },
    },
  });
  console.log("  ✓ Contest:", contest4.title);

  console.log("✅ Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
