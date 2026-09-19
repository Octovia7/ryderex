import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as adminController from './controllers/adminController';
import { driverApplicationParamsSchema } from './schemas/driverApplicationParams.schema';
import { listDriverApplicationsQuerySchema } from './schemas/listDriverApplications.schema';
import { rejectDriverApplicationSchema } from './schemas/rejectDriverApplication.schema';

const router = Router();

// Whole router gated ADMIN — a narrow module with two workflows, no user
// management, no ride/booking/financial overrides.
router.use(authenticate, authorize('ADMIN'));

router.get(
  '/driver-applications',
  validateQuery(listDriverApplicationsQuerySchema),
  adminController.listDriverApplications,
);
router.post(
  '/driver-applications/:userId/verify',
  validateParams(driverApplicationParamsSchema),
  adminController.verifyDriverApplication,
);
router.post(
  '/driver-applications/:userId/reject',
  validateParams(driverApplicationParamsSchema),
  validateBody(rejectDriverApplicationSchema),
  adminController.rejectDriverApplication,
);

export default router;
