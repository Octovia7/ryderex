import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateParams } from '../../middleware/validateParams';
import * as bookingController from './controllers/bookingController';
import { bookingIdParamsSchema } from './schemas/bookingIdParams.schema';

const router = Router();

// No role gate: any authenticated user may hold a booking. Who may SEE one is a
// per-booking rule (its passenger, or the ride's driver), so it lives in the
// service — everyone else gets 404, never 403.
router.get(
  '/:id',
  authenticate,
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
