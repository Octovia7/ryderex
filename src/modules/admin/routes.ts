import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as adminController from './controllers/adminController';
import * as adminVehicleController from './controllers/adminVehicleController';
import { driverApplicationParamsSchema } from './schemas/driverApplicationParams.schema';
import { listDriverApplicationsQuerySchema } from './schemas/listDriverApplications.schema';
import { listVehiclesQuerySchema } from './schemas/listVehicles.schema';
import { rejectDriverApplicationSchema } from './schemas/rejectDriverApplication.schema';
import { rejectVehicleSchema } from './schemas/rejectVehicle.schema';
import { vehicleParamsSchema } from './schemas/vehicleParams.schema';

const router = Router();

// Whole router gated ADMIN — a narrow module with two workflows (driving
// licences, vehicle documents), no user management, no ride/booking/financial
// overrides.
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

router.get(
  '/vehicles',
  validateQuery(listVehiclesQuerySchema),
  adminVehicleController.listVehicles,
);
router.get('/vehicles/:id', validateParams(vehicleParamsSchema), adminVehicleController.getVehicle);
router.post(
  '/vehicles/:id/verify',
  validateParams(vehicleParamsSchema),
  adminVehicleController.verifyVehicle,
);
router.post(
  '/vehicles/:id/reject',
  validateParams(vehicleParamsSchema),
  validateBody(rejectVehicleSchema),
  adminVehicleController.rejectVehicle,
);

export default router;
