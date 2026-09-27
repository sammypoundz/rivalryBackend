// Seed a MEGA contest with 1000 contestants — used to test how the
// "View all contestants" grid handles a huge roster (pagination, density,
// live vote ranking, etc.).
//
// Run from the backend folder:  node scripts/seed-mega.mjs
// Idempotent-ish: if the contest already exists, it re-wipes only its
// contestants and re-creates them.

import { prisma } from "../src/config/prisma.js";
import bcrypt from "bcryptjs";

const COVERS = [
  "photo-1531123897727-8f129e1688ce",
  "photo-1580489944761-15a19d654956",
  "photo-1507003211169-0a1dd7228f2d",
  "photo-1589156280159-27698a70f29e",
  "photo-1573497019940-1c28c88b4f3e",
  "photo-1560250097-0b93528c311a",
  "photo-1524504388940-b1c1722653e1",
  "photo-1506794778202-cad84cf45f1d",
  "photo-1544005313-94ddf0286df2",
  "photo-1519085360753-af0119f7cbe7",
  "photo-1534528741775-53994a69daeb",
  "photo-1517365830460-955ce3ccd263",
  "photo-1531746020798-e6953c6e8e04",
  "photo-1472099645785-5658abf4ff4e",
].map(
  (id) => `https://images.unsplash.com/${id}?q=80&w=600&auto=format&fit=crop`,
);

const FIRST = [
  "Amara",
  "Zainab",
  "Tunde",
  "Ngozi",
  "Chiamaka",
  "Ifeanyi",
  "Kemi",
  "Emeka",
  "Fatima",
  "Seyi",
  "Ada",
  "Musa",
  "Bisi",
  "Oluwaseun",
  "Hadiza",
  "Chidi",
  "Adaeze",
  "Obinna",
  "Yemi",
  "Ihuoma",
  "Kelechi",
  "Aisha",
  "Chuka",
  "Nneka",
  "Uche",
  "Damilola",
  "Chinedu",
  "Chinyere",
  "Ikenna",
  "Halima",
];
const LAST = [
  "Okafor",
  "Bello",
  "Adeyemi",
  "Eze",
  "Obi",
  "Nwosu",
  "Balogun",
  "Duru",
  "Sule",
  "Afolabi",
  "Umeh",
  "Danjuma",
  "Adewale",
  "Akin",
  "Yusuf",
  "Oke",
  "Ogun",
  "Ekwueme",
  "Oyinlola",
  "Iwu",
  "Udo",
  "Sani",
  "Anyanwu",
  "Ariwodo",
  "Nnaji",
  "Osadebe",
  "Eneh",
  "Osimiri",
  "Iroko",
  "Amadi",
];
const STATES = [
  "Lagos, Nigeria",
  "Abuja, Nigeria",
  "Ibadan, Nigeria",
  "Enugu, Nigeria",
  "Port Harcourt, Nigeria",
  "Onitsha, Nigeria",
  "Kano, Nigeria",
  "Abeokuta, Nigeria",
  "Jos, Nigeria",
  "Osogbo, Nigeria",
  "Kaduna, Nigeria",
  "Nnewi, Nigeria",
  "Aba, Nigeria",
  "Ilorin, Nigeria",
];
const JOBS = [
  "Architect & Model",
  "Medical Student",
  "Tech Founder",
  "Fashion Designer",
  "Blogger & TV Presenter",
  "Chef & Restaurateur",
  "Afro-soul Singer",
  "Dancer & Choreographer",
  "Poet & Spoken Word Artist",
  "Comedian & Skit Maker",
  "Stylist",
  "Leatherwear Designer",
  "Textile Artist",
  "Policy Analyst",
  "Public Health Advocate",
  "Photographer",
  "Makeup Artist",
  "Entrepreneur",
];

async function main() {
  console.log("🌱 Seeding MEGA contest (1000 contestants)…");

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
  console.log("  ✓ Admin:", admin.email);

  const endsAt = new Date(Date.now() + 12 * 86400000);

  // One contest, wipe + recreate its contestants so re-running stays clean.
  let contest = await prisma.contest.findFirst({
    where: { title: "Rivalry Mega Pageant" },
  });
  if (contest) {
    await prisma.supporter.deleteMany({
      where: { contestant: { contestId: contest.id } },
    });
    await prisma.vote.deleteMany({
      where: { contestant: { contestId: contest.id } },
    });
    await prisma.like.deleteMany({
      where: { contestant: { contestId: contest.id } },
    });
    await prisma.imageLike.deleteMany({
      where: { contestant: { contestId: contest.id } },
    });
    await prisma.contestant.deleteMany({ where: { contestId: contest.id } });
  } else {
    contest = await prisma.contest.create({
      data: {
        title: "Rivalry Mega Pageant",
        tagline: "1000 queens. One crown. The biggest showdown yet.",
        category: "Pageant",
        coverImage:
          "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=1200&auto=format&fit=crop",
        status: "voting-live",
        endsAt,
        totalVotes: 0,
        rewards: [
          {
            position: "1st Place",
            amount: 10000000,
            perk: "₦10M cash + global tour",
          },
          {
            position: "2nd Place",
            amount: 5000000,
            perk: "₦5M cash + documentary feature",
          },
          {
            position: "3rd Place",
            amount: 2500000,
            perk: "₦2.5M cash + styling grant",
          },
        ],
      },
    });
  }
  console.log("  ✓ Contest:", contest.title, "(1000 contestants)");

  // `number` is globally unique in the schema — use a wide range reserved for
  // this contest so it never collides with the small seed ids or join numbers.
  const usedNumbers = new Set(
    (await prisma.contestant.findMany({ select: { number: true } })).map(
      (c) => c.number,
    ),
  );
  const N = 1000;
  const rows = [];
  let next = 500000;
  for (let i = 0; i < N; i++) {
    while (usedNumbers.has(next)) next++;
    usedNumbers.add(next);
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    // Spread votes so the live ranking has a believable distribution.
    const votes = Math.max(
      0,
      Math.round(24000 * Math.exp(-i / 220) + (i % 97) * 31),
    );
    rows.push({
      contestId: contest.id,
      number: next,
      name: `${first} ${last}`,
      state: STATES[i % STATES.length],
      age: 20 + (i % 10),
      occupation: JOBS[i % JOBS.length],
      bio: `${first} ${last} (#${next}) is competing in the Mega Pageant — vote to push them to the top!`,
      heroImage: COVERS[i % COVERS.length],
      gallery: [],
      votes,
      voteGoal: 25000,
      rank: i + 1,
      prize: 50000,
      likes: (i * 7) % 400,
      votingEndsAt: endsAt,
    });
  }

  // createMany in chunks (Mongo can choke on giant batches).
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.contestant.createMany({ data: rows.slice(i, i + CHUNK) });
    process.stdout.write(
      `  ↳ ${Math.min(i + CHUNK, rows.length)}/${rows.length} contestants\r`,
    );
  }
  console.log("");

  // Contest total = sum of all contestant votes.
  await prisma.contest.update({
    where: { id: contest.id },
    data: { totalVotes: rows.reduce((s, r) => s + r.votes, 0) },
  });

  console.log(
    "✅ Mega seed complete — open the contest and tap 'View all contestants'.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
