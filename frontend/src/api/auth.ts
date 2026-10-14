import { apiFetch } from './client';

// Verified directly against prisma/schema.prisma's User model and the
// fields src/modules/auth/services/tokenService.ts and the OTP flow
// actually return — not the full model, only what auth responses carry.
export interface User {
  id: string;
  email: string;
  phone: string;
  name: string;
  profileImageUrl: string | null;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  driverRatingAverage: number | null;
  driverRatingCount: number;
  passengerRatingAverage: number | null;
  passengerRatingCount: number;
  driverLicenseStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
  driverLicenseRejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface VerifyOtpResult extends AuthTokens {
  user: User;
}

// POST /api/v1/auth/request-otp — src/modules/auth/schemas/requestOtp.schema.ts.
// Always returns the same generic message whether or not the account
// exists (anti-enumeration) — never branch UI behavior on this response.
export function requestOtp(email: string): Promise<{ message: string }> {
  return apiFetch('/auth/request-otp', { method: 'POST', body: { email } });
}

// POST /api/v1/auth/verify-otp — src/modules/auth/schemas/verifyOtp.schema.ts.
// `name`/`phone` are required ONLY when this email has no existing account;
// the backend checks this before consuming the OTP (src/modules/auth/
// services/otpService.ts), so retrying with them after a 400 reuses the
// same code rather than needing a fresh one.
export function verifyOtp(input: {
  email: string;
  otp: string;
  name?: string;
  phone?: string;
}): Promise<VerifyOtpResult> {
  return apiFetch('/auth/verify-otp', { method: 'POST', body: input });
}

// POST /api/v1/auth/refresh — src/modules/auth/schemas/refresh.schema.ts.
// Refresh tokens are opaque, rotating, single-use: this response's
// refreshToken replaces the one just spent, never reused.
export interface RefreshResult extends AuthTokens {
  user: User;
}

export function refreshSession(refreshToken: string): Promise<RefreshResult> {
  return apiFetch('/auth/refresh', { method: 'POST', body: { refreshToken } });
}

// POST /api/v1/auth/logout — src/modules/auth/schemas/logout.schema.ts.
export function logout(refreshToken: string, allDevices = false): Promise<null> {
  return apiFetch('/auth/logout', { method: 'POST', body: { refreshToken, allDevices } });
}
