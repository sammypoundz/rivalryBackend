import express from "express";
import cors from "cors";
import morgan from "morgan";
import { config } from "./config/index.js";
import authRoutes from "./routes/auth.routes.js";
import contestRoutes from "./routes/contest.routes.js";
import userRoutes from "./routes/user.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import {
  contestContestantsRouter,
  contestantRouter,
} from "./routes/contestant.routes.js";
import { notFound, errorHandler } from "./middleware/error.js";

const app = express();

app.use(cors({ origin: config.clientUrl, credentials: true }));
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
app.use("/api/uploads", uploadRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
