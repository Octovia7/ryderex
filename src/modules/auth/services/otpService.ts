import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { config } from '../../../config';
import { emailProvider } from '../../../infrastructure/email';
import { consumeRateLimit } from '../../../infrastructure/redis/rateLimit';
import { redis } from '../../../infrastructure/redis/redisClient';
import { AppError } from '../../../shared/AppError';
import * as userService from '../../user/services/userService';

const BCRYPT_OTP_ROUNDS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

interface OtpRecord {
  otpHash: string;
  attemptCount: number;
}

function otpKey(email: string): string {
  return `otp:login:${email}`;
}

export async function requestOtp(email: string, ip: string): Promise<void> {
  const ipLimit = await consumeRateLimit(
    `ratelimit:otp-request-ip:${ip}`,
    RATE_LIMIT_WINDOW_SECONDS,
    config.otp.requestIpMax,
  );
  if (!ipLimit.allowed) {
    throw new AppError({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many OTP requests. Try again later.',
    });
  }

  const cooldown = await consumeRateLimit(
    `ratelimit:otp-resend:${email}`,
    config.otp.resendCooldownSeconds,
    1,
  );
  if (!cooldown.allowed) {
    throw new AppError({
      statusCode: 429,
      code: 'OTP_RESEND_COOLDOWN',
      message: 'Please wait before requesting another code.',
    });
  }

  const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const otpHash = await bcrypt.hash(otp, BCRYPT_OTP_ROUNDS);
  const record: OtpRecord = { otpHash, attemptCount: 0 };

  try {
    await redis.set(otpKey(email), JSON.stringify(record), 'EX', config.otp.ttlSeconds);
  } catch (cause) {
    throw new AppError({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Login is temporarily unavailable.',
      cause,
    });
  }

  // Never logged in plaintext outside this dev-only fallback (ConsoleEmailProvider).
  await emailProvider.sendOtpEmail({ email, otp });
}

interface VerifyOtpInput {
  email: string;
  otp: string;
  name?: string;
  phone?: string;
  ip: string;
}

export interface ResolvedUser {
  id: string;
  email: string;
  phone: string;
  name: string;
  role: string;
  status: string;
}

// Resolves the OTP and the account it belongs to (creating a PASSENGER on
// first login), but issues no tokens — that is tokenService's concern.
export async function verifyOtpAndResolveUser(input: VerifyOtpInput): Promise<ResolvedUser> {
  const ipLimit = await consumeRateLimit(
    `ratelimit:otp-verify-ip:${input.ip}`,
    RATE_LIMIT_WINDOW_SECONDS,
    config.otp.verifyIpMax,
  );
  if (!ipLimit.allowed) {
    throw new AppError({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again later.',
    });
  }

  const key = otpKey(input.email);
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch (cause) {
    throw new AppError({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Login is temporarily unavailable.',
      cause,
    });
  }

  if (!raw) {
    throw new AppError({
      statusCode: 400,
      code: 'OTP_EXPIRED',
      message: 'The code has expired or was not requested.',
    });
  }

  const record = JSON.parse(raw) as OtpRecord;

  if (record.attemptCount >= config.otp.maxAttempts) {
    await redis.del(key);
    throw new AppError({
      statusCode: 400,
      code: 'OTP_TOO_MANY_ATTEMPTS',
      message: 'Too many incorrect attempts.',
    });
  }

  const matches = await bcrypt.compare(input.otp, record.otpHash);
  if (!matches) {
    const ttl = await redis.ttl(key);
    const remainingTtl = ttl > 0 ? ttl : config.otp.ttlSeconds;
    const updated: OtpRecord = { ...record, attemptCount: record.attemptCount + 1 };
    await redis.set(key, JSON.stringify(updated), 'EX', remainingTtl);

    throw new AppError({
      statusCode: 400,
      code: 'INVALID_OTP',
      message: 'Incorrect code.',
    });
  }

  const existingUser = await userService.findByEmail(input.email);

  // Checked before the code is consumed: otherwise a signup that forgot
  // name/phone would burn a single-use code on a request it can't complete.
  if (!existingUser && (!input.name || !input.phone)) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'name and phone are required to create a new account.',
    });
  }

  await redis.del(key);

  const user =
    existingUser ??
    (await userService.createPassenger({
      email: input.email,
      name: input.name as string,
      phone: input.phone as string,
    }));

  if (user.status === 'SUSPENDED') {
    throw new AppError({
      statusCode: 403,
      code: 'ACCOUNT_SUSPENDED',
      message: 'This account is suspended.',
    });
  }

  return user;
}
