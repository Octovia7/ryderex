import 'dotenv/config';
import { z } from 'zod';
import { AppError } from '../shared/AppError';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // A hop count, never a bare boolean cast — z.coerce.boolean() would turn
  // the string "false" into true, and trusting every hop lets a client
  // rotate X-Forwarded-For to mint a fresh rate-limit bucket per request.
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Wired for the first time in the auth phase.
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_ACCESS_TOKEN_EXPIRY_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_REQUEST_IP_MAX: z.coerce.number().int().positive().default(10),
  OTP_VERIFY_IP_MAX: z.coerce.number().int().positive().default(10),

  // Absent in development: falls back to ConsoleEmailProvider (OTP to stdout).
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new AppError({
      statusCode: 500,
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      message: 'Environment variable validation failed.',
      cause: parsed.error.flatten(),
    });
  }

  return parsed.data;
}

const env = loadEnv();

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  trustProxy: env.TRUST_PROXY === 'true',
  corsOrigins: env.CORS_ORIGINS,
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTokenExpiryMinutes: env.JWT_ACCESS_TOKEN_EXPIRY_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  },
  otp: {
    ttlSeconds: env.OTP_TTL_SECONDS,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    resendCooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    requestIpMax: env.OTP_REQUEST_IP_MAX,
    verifyIpMax: env.OTP_VERIFY_IP_MAX,
  },
  brevo: {
    apiKey: env.BREVO_API_KEY,
    senderEmail: env.BREVO_SENDER_EMAIL,
  },
} as const;

export type Config = typeof config;
