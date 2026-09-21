import { prisma } from "../src/config/prisma.js";

const REFERRER_ID = "6ab127cc1f2e054197100aed";

const invites = await prisma.referralInvite.findMany({
  where: { referrerId: REFERRER_ID },
  orderBy: { createdAt: "desc" },
  take: 3,
});
console.log(
  JSON.stringify(
    invites.map((i) => ({
      name: i.name,
      contact: i.contact,
      status: i.status,
      reward: i.reward,
      referrerId: i.referrerId,
      contestId: i.contestId,
      claimedById: i.claimedById,
    })),
    null,
    1,
  ),
);

const users = await prisma.user.findMany({
  where: { email: { in: ["gatecheck3@mail.com", "gatecheck2@mail.com"] } },
  select: { email: true, id: true, referredById: true },
});
console.log(JSON.stringify(users, null, 1));

const user = users[0];
if (user) {
  const contestants = await prisma.contestant.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, votes: true },
  });
  console.log("contestants:", JSON.stringify(contestants));
}

await prisma.$disconnect();
