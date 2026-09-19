import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { uploadDocument, validateDocumentMagicBytes } from '../../middleware/uploadDocument';
import { validateBody } from '../../middleware/validateBody';
import * as userController from './controllers/userController';
import { updateProfileSchema } from './schemas/updateProfile.schema';

const router = Router();

router.get('/me', authenticate, userController.getMe);
router.patch('/me', authenticate, validateBody(updateProfileSchema), userController.updateMe);
router.post(
  '/me/driver-application',
  authenticate,
  uploadDocument.single('document'),
  validateDocumentMagicBytes,
  userController.submitDriverApplication,
);

export default router;
