import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { documentUploadRateLimit } from '../../middleware/rateLimits';
import { uploadDocument, validateDocumentMagicBytes } from '../../middleware/uploadDocument';
import { validateBody } from '../../middleware/validateBody';
import * as userController from './controllers/userController';
import { updateProfileSchema } from './schemas/updateProfile.schema';

const router = Router();

// The generous "authenticated reads" catch-all (architecture.md §15).
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

router.get('/me', authenticate, authenticatedReadRateLimit, userController.getMe);
router.patch('/me', authenticate, validateBody(updateProfileSchema), userController.updateMe);
// `documentUploadRateLimit` is the SAME middleware instance the vehicle
// module's document upload uses — one shared bucket per user across both
// endpoints, placed before the multer parser.
router.post(
  '/me/driver-application',
  authenticate,
  documentUploadRateLimit,
  uploadDocument.single('document'),
  validateDocumentMagicBytes,
  userController.submitDriverApplication,
);

export default router;
