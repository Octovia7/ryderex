import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as notificationController from './controllers/notificationController';
import { listNotificationsQuerySchema } from './schemas/listNotifications.schema';
import { notificationIdParamsSchema } from './schemas/notificationIdParams.schema';

const router = Router();

// The generous "authenticated reads" catch-all (architecture.md §15).
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

// No role gate: any authenticated user reads their own notifications only —
// scoped in the service by the caller's own id, never a route/body parameter.
router.get(
  '/',
  authenticate,
  authenticatedReadRateLimit,
  validateQuery(listNotificationsQuerySchema),
  notificationController.listNotifications,
);

// Ownership-scoped in the service, not here — anyone else's id, or an
// unknown one, gets the same 404.
router.patch(
  '/:id/read',
  authenticate,
  validateParams(notificationIdParamsSchema),
  notificationController.markNotificationRead,
);

export default router;
