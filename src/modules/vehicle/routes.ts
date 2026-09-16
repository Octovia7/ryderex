import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import * as vehicleController from './controllers/vehicleController';
import { createVehicleSchema } from './schemas/createVehicle.schema';
import { updateVehicleSchema } from './schemas/updateVehicle.schema';
import { vehicleIdParamsSchema } from './schemas/vehicleIdParams.schema';

const router = Router();

router.post(
  '/',
  authenticate,
  authorize('DRIVER'),
  validateBody(createVehicleSchema),
  vehicleController.createVehicle,
);
router.get('/', authenticate, vehicleController.listVehicles);
router.get(
  '/:id',
  authenticate,
  validateParams(vehicleIdParamsSchema),
  vehicleController.getVehicle,
);
router.patch(
  '/:id',
  authenticate,
  validateParams(vehicleIdParamsSchema),
  validateBody(updateVehicleSchema),
  vehicleController.updateVehicle,
);

export default router;
