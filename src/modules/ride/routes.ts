import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import * as rideController from './controllers/rideController';
import { createRideSchema } from './schemas/createRide.schema';
import { rideIdParamsSchema } from './schemas/rideIdParams.schema';

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
router.get('/:id', authenticate, validateParams(rideIdParamsSchema), rideController.getRide);
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
