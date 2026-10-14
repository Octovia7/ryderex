import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as ratingController from '../rating/controllers/ratingController';
import { submitRatingSchema } from '../rating/schemas/submitRating.schema';
import * as bookingController from './controllers/bookingController';
import { bookingIdParamsSchema } from './schemas/bookingIdParams.schema';
import { listBookingsQuerySchema } from './schemas/listBookings.schema';

const router = Router();

// The generous "authenticated reads" catch-all (architecture.md §15).
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

// The caller's own bookings, newest-first, cursor-paginated — scoped by
// req.user.id inside the service, never a query/body parameter, so this can
// never return another user's rows (the same IDOR convention every other
// resource in this codebase follows). Role-gated PASSENGER + DRIVER for the
// same reason as every other route below.
router.get(
  '/',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
  authenticatedReadRateLimit,
  validateQuery(listBookingsQuerySchema),
  bookingController.listBookings,
);

// Role-gated to PASSENGER + DRIVER (a driver is still a passenger, so this
// excludes only ADMIN — architecture.md §14). Who may SEE a given booking is
// a separate, per-booking rule (its passenger, or the ride's driver), so that
// still lives in the service — everyone else gets 404, never 403.
router.get(
  '/:id',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
  authenticatedReadRateLimit,
  validateParams(bookingIdParamsSchema),
  bookingController.getBooking,
);

// Checkout details are the PASSENGER's alone — unlike GET /:id above, the
// ride's driver never sees this: they are not the one paying the
// prepayment. 409 CHECKOUT_NOT_AVAILABLE (not 404) when the booking is
// theirs but there's simply nothing to check out right now (already
// resolved, no order yet, or Razorpay isn't the active provider).
router.get(
  '/:id/checkout',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
  authenticatedReadRateLimit,
  validateParams(bookingIdParamsSchema),
  bookingController.getCheckout,
);

// Cancelling is the PASSENGER's alone (the ride's driver may view a booking but not
// cancel it), so a non-passenger gets the same 404 as an unknown id.
router.post(
  '/:id/cancel',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
  validateParams(bookingIdParamsSchema),
  bookingController.cancelBooking,
);

// Role-gated to PASSENGER + DRIVER for the same reason as above. No
// rating-specific rate limiter (Phase 14 never defined one for ratings — the
// shared `Idempotency-Key` pattern doesn't apply either, since a repeat
// submission is a hard `409 ALREADY_RATED`, never a replay). Participant
// authorization for both routes lives entirely in ratingService, reusing
// bookingService's own "booking exists AND caller is a participant" check —
// the same 404-not-403 IDOR convention as every other route on this router.
router.get(
  '/:id/ratings',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
  authenticatedReadRateLimit,
  validateParams(bookingIdParamsSchema),
  ratingController.listRatingsForBooking,
);
router.post(
  '/:id/ratings',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
  validateParams(bookingIdParamsSchema),
  validateBody(submitRatingSchema),
  ratingController.submitRating,
);

export default router;
