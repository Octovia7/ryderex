import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { documentUploadRateLimit } from '../../middleware/rateLimits';
import { uploadDocument, validateDocumentMagicBytes } from '../../middleware/uploadDocument';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import * as vehicleController from './controllers/vehicleController';
import { createVehicleSchema } from './schemas/createVehicle.schema';
import { updateVehicleSchema } from './schemas/updateVehicle.schema';
import { uploadVehicleDocumentSchema } from './schemas/uploadVehicleDocument.schema';
import { vehicleIdParamsSchema } from './schemas/vehicleIdParams.schema';

const router = Router();

// The generous "authenticated reads" catch-all (architecture.md §15) — every
// authenticated GET route on this router with no more specific category.
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

router.post(
  '/',
  authenticate,
  authorize('DRIVER'),
  validateBody(createVehicleSchema),
  vehicleController.createVehicle,
);
router.get('/', authenticate, authenticatedReadRateLimit, vehicleController.listVehicles);
router.get(
  '/:id',
  authenticate,
  authenticatedReadRateLimit,
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
// `documentUploadRateLimit` is BEFORE the multer parser, so a rate-limited
// request never has its file body parsed — and it is the SAME middleware
// instance the user module's driver-licence upload uses, sharing one
// bucket per user across both endpoints.
router.post(
  '/:id/documents',
  authenticate,
  validateParams(vehicleIdParamsSchema),
  documentUploadRateLimit,
  uploadDocument.single('document'),
  validateDocumentMagicBytes,
  validateBody(uploadVehicleDocumentSchema),
  vehicleController.uploadVehicleDocument,
);

export default router;
