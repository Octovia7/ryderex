import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { validateParams } from '../../middleware/validateParams';
import * as bookingController from './controllers/bookingController';
import { bookingIdParamsSchema } from './schemas/bookingIdParams.schema';

const router = Router();

// The generous "authenticated reads" catch-all (architecture.md §15).
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

// No role gate: any authenticated user may hold a booking. Who may SEE one is a
// per-booking rule (its passenger, or the ride's driver), so it lives in the
// service — everyone else gets 404, never 403.
router.get(
  '/:id',
  authenticate,
  authenticatedReadRateLimit,
  validateParams(bookingIdParamsSchema),
  bookingController.getBooking,
);

// Cancelling is the PASSENGER's alone (the ride's driver may view a booking but not
// cancel it), so a non-passenger gets the same 404 as an unknown id.
router.post(
  '/:id/cancel',
  authenticate,
  validateParams(bookingIdParamsSchema),
  bookingController.cancelBooking,
);

export default router;
