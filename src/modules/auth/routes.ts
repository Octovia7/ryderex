import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { validateBody } from '../../middleware/validateBody';
import * as authController from './controllers/authController';
import { logoutSchema } from './schemas/logout.schema';
import { refreshSchema } from './schemas/refresh.schema';
import { requestOtpSchema } from './schemas/requestOtp.schema';
import { verifyOtpSchema } from './schemas/verifyOtp.schema';

const router = Router();

// OTP request/verify keep their own existing per-IP limits, enforced inside
// otpService itself (migrated onto the same shared limiter, not duplicated
// here as route middleware).
//
// `/refresh` and `/logout` are one category, one shared bucket, per IP —
// neither route has `req.user` yet (a refresh/logout call authenticates
// itself via the token in the body, not a Bearer header), so this cannot be
// keyed on a user id the way most other categories are.
const authRefreshRateLimit = rateLimit({
  prefix: 'auth-refresh',
  keyBy: 'ip',
  windowSeconds: 3600,
  max: config.rateLimits.authRefreshPerHour,
});

router.post('/request-otp', validateBody(requestOtpSchema), authController.requestOtp);
router.post('/verify-otp', validateBody(verifyOtpSchema), authController.verifyOtp);
router.post('/refresh', authRefreshRateLimit, validateBody(refreshSchema), authController.refresh);
router.post('/logout', authRefreshRateLimit, validateBody(logoutSchema), authController.logout);

export default router;
