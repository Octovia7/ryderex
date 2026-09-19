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

  // No safe fallback exists for document storage. Left optional for local
  // development without a Cloudinary account; CloudinaryDocumentProvider
  // throws clearly at call time when unconfigured rather than at boot.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Separate from the base credentials above — this is Cloudinary's Auth
  // Token feature key, needed for genuinely time-boxed signed URLs. Without
  // it, delivery falls back to a signed-but-not-expiring URL. Requires the
  // Cloudinary account's own "Strict transformations" / Auth Token security
  // setting to be enabled — account-side configuration this app cannot set.
  CLOUDINARY_AUTH_TOKEN_KEY: z.string().optional(),
  DOCUMENT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
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
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    authTokenKey: env.CLOUDINARY_AUTH_TOKEN_KEY,
    signedUrlTtlSeconds: env.DOCUMENT_SIGNED_URL_TTL_SECONDS,
  },
} as const;

export type Config = typeof config;
