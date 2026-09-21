import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
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

// Only ride creation is role-gated. Everything else is either open to any
// authenticated user (reading a ride) or ownership-scoped in the service
// (start / complete / cancel — a non-owner gets 404, never 403).
router.post(
  '/',
  authenticate,
  authorize('DRIVER'),
  validateBody(createRideSchema),
  rideController.createRide,
);
// Registered BEFORE `/:id`: Express matches routes in order, so declared after
// it, `search` would be captured as an `:id` value and rejected as a bad UUID.
router.get(
  '/search',
  authenticate,
  validateQuery(searchRidesQuerySchema),
  rideController.searchRides,
);
router.get('/:id', authenticate, validateParams(rideIdParamsSchema), rideController.getRide);
// Booking is nested under the ride resource, so it is ROUTED here, but its
// controller, service and repository all belong to the booking module. No role
// gate: a driver may book a seat on someone else's ride (their own is refused
// in the service). Routing is the only thing that crosses the module boundary.
router.post(
  '/:id/bookings',
  authenticate,
  validateParams(rideIdParamsSchema),
  validateBody(createBookingSchema),
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
