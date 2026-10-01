import express from "express";
import cors from "cors";
import morgan from "morgan";
import { config } from "./config/index.js";
import authRoutes from "./routes/auth.routes.js";
import contestRoutes from "./routes/contest.routes.js";
import userRoutes from "./routes/user.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import {
  contestContestantsRouter,
  contestantRouter,
} from "./routes/contestant.routes.js";
import { notFound, errorHandler } from "./middleware/error.js";
import * as voteController from "./controllers/vote.controller.js";

const app = express();

app.use(cors({ origin: config.clientUrls, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) =>
  res.json({
    success: true,
    message: "Rivalry API is running",
    time: new Date().toISOString(),
  }),
);

app.use("/api/auth", authRoutes);
app.use("/api/contests", contestRoutes);
app.use("/api/contests/:contestId/contestants", contestContestantsRouter);
app.use("/api/contestants", contestantRouter);
app.use("/api/users", userRoutes);
// Admin dashboard (every route inside already enforces requireAuth + requireAdmin)
app.use("/api/admin", adminRoutes);
app.use("/api/uploads", uploadRoutes);

// Live votes feed (real Vote records across all contests)
app.get("/api/votes/recent", voteController.listRecentVotes);

// Share-link OG landing pages (crawler-friendly preview + human redirect)
import { voteOg, voteOgImage } from "./controllers/og.controller.js";
app.get("/api/og/vote/:id", voteOg);
app.get("/api/og/vote/:id/image", voteOgImage);

// Contest share links: crawler-friendly OG preview of the contest cover + title
import { contestOg, contestOgImage } from "./controllers/og.controller.js";
app.get("/api/og/contest/:id", contestOg);
app.get("/api/og/contest/:id/image", contestOgImage);

app.use(notFound);
app.use(errorHandler);

export default app;
