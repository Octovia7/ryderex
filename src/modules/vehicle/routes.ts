import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { uploadDocument, validateDocumentMagicBytes } from '../../middleware/uploadDocument';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import * as vehicleController from './controllers/vehicleController';
import { createVehicleSchema } from './schemas/createVehicle.schema';
import { updateVehicleSchema } from './schemas/updateVehicle.schema';
import { uploadVehicleDocumentSchema } from './schemas/uploadVehicleDocument.schema';
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
// No role gate: only vehicle creation is role-gated; the service scopes this
// to the vehicle's owner (404 otherwise). Reuses the Phase 4.5 upload chain.
router.post(
  '/:id/documents',
  authenticate,
  validateParams(vehicleIdParamsSchema),
  uploadDocument.single('document'),
  validateDocumentMagicBytes,
  validateBody(uploadVehicleDocumentSchema),
  vehicleController.uploadVehicleDocument,
);

export default router;
