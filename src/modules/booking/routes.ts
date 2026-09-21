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

export default router;
