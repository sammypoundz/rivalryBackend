import { Router } from "express";
import * as contestant from "../controllers/contestant.controller.js";
import * as vote from "../controllers/vote.controller.js";
import { requireAuth, requireAdmin, optionalAuth } from "../middleware/auth.js";

const router = Router({ mergeParams: true });

// Contestants under a contest
router.get("/", contestant.listByContest); // /api/contests/:contestId/contestants
// Contestants under a contest (any logged-in user may enter themselves;
// the contestant is linked to their account in the controller)
router.post("/", requireAuth, contestant.createContestant);

// Individual contestant routes mounted at /api/contestants
const single = Router();

single.get("/:id", contestant.getContestant);
single.post("/:id/like", optionalAuth, contestant.toggleLike);
single.post("/:id/gallery", requireAuth, contestant.addGalleryImage);
single.delete("/:id/gallery", requireAuth, contestant.removeGalleryImage);
single.put("/:id", requireAuth, requireAdmin, contestant.updateContestant);
single.delete("/:id", requireAuth, requireAdmin, contestant.deleteContestant);

// Voting
single.post("/:id/vote", optionalAuth, vote.vote);
single.get("/:id/supporters", vote.listSupporters);
single.get("/:id/votes", vote.listVotes);

export { router as contestContestantsRouter, single as contestantRouter };
