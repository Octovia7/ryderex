import express, { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import * as webhookController from './controllers/webhookController';

const router = Router();

// Per IP, deliberately high (architecture.md §15: "dropping a real payment
// webhook is far worse than absorbing traffic") — placed BEFORE the raw-body
// parser, so a flooding request never even has its body buffered.
const webhookRateLimit = rateLimit({
  prefix: 'webhook',
  keyBy: 'ip',
  windowSeconds: 60,
  max: config.rateLimits.webhookPerMinute,
});

// A dedicated raw-body parser, scoped to this one route only — never the
// shared express.json() every other route uses. Signature verification needs
// the exact bytes Razorpay signed; a JSON-parsed-then-re-serialized body is
// not guaranteed to be byte-identical (key order, whitespace, number
// formatting), which would make a genuine signature fail verification.
//
// No `authenticate` here: this endpoint is never called by our own users,
// only by Razorpay — the signature IS the auth. No `validateBody` either:
// the body isn't trustworthy JSON until AFTER the signature check, which is
// why validation happens inside webhookService, not as route middleware.
router.post(
  '/payment',
  webhookRateLimit,
  express.raw({ type: 'application/json', limit: '1mb' }),
  webhookController.handlePaymentWebhook,
);

export default router;
