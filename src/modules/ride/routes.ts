import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { idempotency } from '../../middleware/idempotency';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as bookingController from '../booking/controllers/bookingController';
import { createBookingSchema } from '../booking/schemas/createBooking.schema';
import * as rideController from './controllers/rideController';
import { createRideSchema } from './schemas/createRide.schema';
import { rideIdParamsSchema } from './schemas/rideIdParams.schema';
import { searchRidesQuerySchema } from './schemas/searchRides.schema';

const router = Router();

const rideSearchRateLimit = rateLimit({
  prefix: 'ride-search',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.rideSearchPerMinute,
});
const rideCreationRateLimit = rateLimit({
  prefix: 'ride-creation',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.rideCreationPerMinute,
});
const bookingCreationRateLimit = rateLimit({
  prefix: 'booking-creation',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.bookingCreationPerMinute,
});
// The generous "authenticated reads" catch-all (architecture.md §15).
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

// Only ride creation is role-gated. Everything else is either open to any
// authenticated user (reading a ride) or ownership-scoped in the service
// (start / complete / cancel — a non-owner gets 404, never 403).
//
// Rate limiting runs AFTER `authorize` (a forbidden request never consumes
// the caller's budget) and BEFORE `validateBody`/`idempotency`.
//
// `idempotency` is the two endpoints that create a payment order
// (architecture.md §11) — after `validateBody`, so it hashes the validated
// body, not the client's raw one.
router.post(
  '/',
  authenticate,
  authorize('DRIVER'),
  rideCreationRateLimit,
  validateBody(createRideSchema),
  idempotency,
  rideController.createRide,
);
// Registered BEFORE `/:id`: Express matches routes in order, so declared after
// it, `search` would be captured as an `:id` value and rejected as a bad UUID.
router.get(
  '/search',
  authenticate,
  rideSearchRateLimit,
  validateQuery(searchRidesQuerySchema),
  rideController.searchRides,
);
// Registered BEFORE `/:id` for the same reason as `/search` above: declared
// after it, `mine` would be captured as an `:id` value and rejected as a bad
// UUID.
router.get('/mine', authenticate, authenticatedReadRateLimit, rideController.getMyRides);
router.get(
  '/:id',
  authenticate,
  authenticatedReadRateLimit,
  validateParams(rideIdParamsSchema),
  rideController.getRide,
);
// Booking is nested under the ride resource, so it is ROUTED here, but its
// controller, service and repository all belong to the booking module. No role
// gate: a driver may book a seat on someone else's ride (their own is refused
// in the service). Routing is the only thing that crosses the module boundary.
router.post(
  '/:id/bookings',
  authenticate,
  validateParams(rideIdParamsSchema),
  bookingCreationRateLimit,
  validateBody(createBookingSchema),
  idempotency,
  bookingController.createBooking,
);
router.post(
  '/:id/cancel',
  authenticate,
  validateParams(rideIdParamsSchema),
  rideController.cancelRide,
);
router.post(
  '/:id/start',
  authenticate,
  validateParams(rideIdParamsSchema),
  rideController.startRide,
);
router.post(
  '/:id/complete',
  authenticate,
  validateParams(rideIdParamsSchema),
  rideController.completeRide,
);

export default router;
