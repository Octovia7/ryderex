import { Router } from 'express';
import { validateBody } from '../../middleware/validateBody';
import * as authController from './controllers/authController';
import { logoutSchema } from './schemas/logout.schema';
import { refreshSchema } from './schemas/refresh.schema';
import { requestOtpSchema } from './schemas/requestOtp.schema';
import { verifyOtpSchema } from './schemas/verifyOtp.schema';

const router = Router();

router.post('/request-otp', validateBody(requestOtpSchema), authController.requestOtp);
router.post('/verify-otp', validateBody(verifyOtpSchema), authController.verifyOtp);
router.post('/refresh', validateBody(refreshSchema), authController.refresh);
router.post('/logout', validateBody(logoutSchema), authController.logout);

export default router;
