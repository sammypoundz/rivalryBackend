import { prisma } from "../config/prisma.js";
import { ApiError } from "../middleware/error.js";

export async function listContests(_req, res, next) {
  try {
    const contests = await prisma.contest.findMany({
      include: { contestants: { orderBy: { votes: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, contests });
  } catch (err) {
    next(err);
  }
}

export async function getContest(req, res, next) {
  try {
    const contest = await prisma.contest.findUnique({
      where: { id: req.params.id },
      include: { contestants: { orderBy: { votes: "desc" } } },
    });
    if (!contest) throw new ApiError(404, "Contest not found");
    res.json({ success: true, contest });
  } catch (err) {
    next(err);
  }
}

export async function createContest(req, res, next) {
  try {
    const { title, tagline, category, coverImage, status, startsAt, endsAt, rewards } = req.body;
    if (!title || !endsAt) throw new ApiError(400, "title and endsAt are required");
    const contest = await prisma.contest.create({
      data: {
        title,
        tagline,
        category,
        coverImage,
        status,
        startsAt: startsAt ? new Date(startsAt) : undefined,
        endsAt: new Date(endsAt),
        rewards,
      },
    });
    res.status(201).json({ success: true, contest });
  } catch (err) {
    next(err);
  }
}

export async function updateContest(req, res, next) {
  try {
    const data = { ...req.body };
    if (data.startsAt) data.startsAt = new Date(data.startsAt);
    if (data.endsAt) data.endsAt = new Date(data.endsAt);
    const contest = await prisma.contest.update({ where: { id: req.params.id }, data });
    res.json({ success: true, contest });
  } catch (err) {
    next(err);
  }
}

export async function deleteContest(req, res, next) {
  try {
    await prisma.contest.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Contest deleted" });
  } catch (err) {
    next(err);
  }
}
