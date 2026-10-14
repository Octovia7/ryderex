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
import { listBookingsQuerySchema } from '../booking/schemas/listBookings.schema';
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

// Ride creation is role-gated to DRIVER. The passenger-facing routes below
// (search, read, book) are role-gated to PASSENGER + DRIVER — a driver is
// still a passenger when they haven't posted a ride (architecture.md §14),
// so this excludes only ADMIN, which has no customer-facing capability.
// start / complete / cancel stay ownership-scoped in the service — a
// non-owner gets 404, never 403.
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
  authorize('PASSENGER', 'DRIVER'),
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
  authorize('PASSENGER', 'DRIVER'),
  authenticatedReadRateLimit,
  validateParams(rideIdParamsSchema),
  rideController.getRide,
);
// Unlike GET /:id above (readable by any passenger/driver for discovery),
// checkout details are the owning DRIVER's alone — role-gated DRIVER, same
// as ride creation, plus the ownership check in the service. 409
// CHECKOUT_NOT_AVAILABLE (not 404) when the ride is theirs but there's
// nothing to check out right now.
router.get(
  '/:id/checkout',
  authenticate,
  authorize('DRIVER'),
  authenticatedReadRateLimit,
  validateParams(rideIdParamsSchema),
  rideController.getCheckout,
);
// Driver-only: lists the bookings ON this ride, for the ride's OWNER alone
// — never any passenger, even one with a booking on it (this is a driver
// management view, not a public read; GET /:id above already serves
// public ride discovery). Role-gated DRIVER, same as ride creation/
// checkout; ownership is re-checked in the service (404, never 403, the
// same IDOR convention as every other owner-scoped read here) since the
// role gate alone can't tell ride A's driver from ride B's. Deliberately
// lean (id/passengerId/passengerName/seats/status/createdAt) — no fare, no
// payment identifiers, no passenger contact details.
router.get(
  '/:id/bookings',
  authenticate,
  authorize('DRIVER'),
  authenticatedReadRateLimit,
  validateParams(rideIdParamsSchema),
  validateQuery(listBookingsQuerySchema),
  bookingController.listBookingsForRide,
);
// Booking is nested under the ride resource, so it is ROUTED here, but its
// controller, service and repository all belong to the booking module. A
// driver may book a seat on someone else's ride (their own is refused in the
// service) — the PASSENGER/DRIVER gate below only excludes ADMIN.
router.post(
  '/:id/bookings',
  authenticate,
  authorize('PASSENGER', 'DRIVER'),
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
