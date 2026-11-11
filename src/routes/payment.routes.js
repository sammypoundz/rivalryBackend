import { Router } from "express";
import {
  createVoteAccount,
  paymentStatus,
  verifyPayment,
} from "../controllers/payment.controller.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

// Guests can vote, so generating an account works anonymously too
// (optionalAuth attaches the user when a token is present).
router.post("/vote-account", optionalAuth, createVoteAccount);
router.get("/:reference/status", paymentStatus);
router.post("/:reference/verify", verifyPayment);

export default router;
