import { AppError } from '../../../shared/AppError';
import * as otpService from './otpService';
import * as tokenService from './tokenService';

export function requestOtp(email: string, ip: string): Promise<void> {
  return otpService.requestOtp(email, ip);
}

export interface VerifyOtpParams {
  email: string;
  otp: string;
  name?: string;
  phone?: string;
  ip: string;
}

export async function verifyOtp(params: VerifyOtpParams) {
  const user = await otpService.verifyOtpAndResolveUser(params);
  const tokens = await tokenService.issueTokensForUser({ id: user.id, role: user.role });

  return { user, ...tokens };
}

export async function refresh(presentedToken: string) {
  const result = await tokenService.rotateRefreshToken(presentedToken);

  switch (result.kind) {
    case 'success':
      return {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    case 'expired':
      throw new AppError({
        statusCode: 401,
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Refresh token has expired.',
      });
    case 'reuse':
      throw new AppError({
        statusCode: 401,
        code: 'REFRESH_TOKEN_REUSE_DETECTED',
        message: 'Refresh token reuse detected.',
      });
    case 'suspended':
      throw new AppError({
        statusCode: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is suspended.',
      });
    case 'not_found':
      throw new AppError({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Invalid refresh token.',
      });
  }
}

export function logout(presentedToken: string, allDevices: boolean): Promise<void> {
  return tokenService.revokeRefreshToken(presentedToken, allDevices);
}
