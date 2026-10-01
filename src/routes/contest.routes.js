import { Router } from "express";
import * as contest from "../controllers/contest.controller.js";
import { requireAuth, requireAdmin, requireOrganiser } from "../middleware/auth.js";

const router = Router();

router.get("/", contest.listContests);
router.get("/:id", contest.getContest);
router.get("/:id/revenue", requireAuth, requireOrganiser, contest.contestRevenue);
// Organisers (self-upgraded) and admins can create/manage contests.
// Non-admins may only touch contests they created (organiserId).
router.post("/", requireAuth, requireOrganiser, contest.createContest);
router.put("/:id", requireAuth, requireOrganiser, contest.updateContest);
router.delete("/:id", requireAuth, requireOrganiser, contest.deleteContest);

export default router;
