import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as authService from '../services/authService';
import type { LogoutInput } from '../schemas/logout.schema';
import type { RefreshInput } from '../schemas/refresh.schema';
import type { RequestOtpInput } from '../schemas/requestOtp.schema';
import type { VerifyOtpInput } from '../schemas/verifyOtp.schema';

export async function requestOtp(req: Request, res: Response): Promise<void> {
  const { email } = req.body as RequestOtpInput;
  await authService.requestOtp(email, req.ip ?? 'unknown');
  sendSuccess(res, { message: 'If this email is eligible, a code has been sent.' });
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const { email, otp, name, phone } = req.body as VerifyOtpInput;
  const result = await authService.verifyOtp({ email, otp, name, phone, ip: req.ip ?? 'unknown' });
  sendSuccess(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;
  const result = await authService.refresh(refreshToken);
  sendSuccess(res, result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken, allDevices } = req.body as LogoutInput;
  await authService.logout(refreshToken, allDevices ?? false);
  sendSuccess(res, null);
}
