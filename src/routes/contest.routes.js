import { Router } from "express";
import * as contest from "../controllers/contest.controller.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

router.get("/", contest.listContests);
router.get("/:id", contest.getContest);
router.post("/", requireAuth, requireAdmin, contest.createContest);
router.put("/:id", requireAuth, requireAdmin, contest.updateContest);
router.delete("/:id", requireAuth, requireAdmin, contest.deleteContest);

export default router;
