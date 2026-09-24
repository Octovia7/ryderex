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

  // Only one implementation exists today, but the env var (rather than a
  // hard-coded choice) is what made the Mapbox -> Geoapify swap a config
  // change instead of a rewrite, and keeps the next swap just as cheap.
  MAP_PROVIDER: z.enum(['geoapify']).default('geoapify'),
  // No safe fallback exists for a map provider, same as Cloudinary — left
  // optional for local development without a Geoapify account;
  // GeoapifyMapProvider throws clearly at call time when unconfigured
  // rather than at boot.
  MAP_PROVIDER_API_KEY: z.string().optional(),

  // Every fare input is configuration, never hard-coded, so a pricing change
  // is a deploy, not a code change. Defaults match the documented formula.
  FARE_BASE_FARE: z.coerce.number().positive().default(30),
  FARE_PRICE_PER_KM: z.coerce.number().positive().default(8),
  FARE_VEHICLE_MULTIPLIER_HATCHBACK: z.coerce.number().positive().default(1.0),
  FARE_VEHICLE_MULTIPLIER_SEDAN: z.coerce.number().positive().default(1.15),
  FARE_VEHICLE_MULTIPLIER_MUV: z.coerce.number().positive().default(1.3),
  FARE_VEHICLE_MULTIPLIER_SUV: z.coerce.number().positive().default(1.35),
  // Bounds, not the multiplier itself — no caller supplies a traffic reading
  // yet (it defaults to 1.0), but a future one — or a bug in one — cannot
  // produce an absurd price because the bounds are enforced regardless.
  FARE_TRAFFIC_MULTIPLIER_MIN: z.coerce.number().positive().default(0.8),
  FARE_TRAFFIC_MULTIPLIER_MAX: z.coerce.number().positive().default(2.0),
  // Driver rating can move a fare by at most ±5% — bounded on purpose, since
  // multipliers compose multiplicatively and a single unbounded one is a
  // pricing incident.
  FARE_RATING_MULTIPLIER_MIN: z.coerce.number().positive().default(0.95),
  FARE_RATING_MULTIPLIER_MAX: z.coerce.number().positive().default(1.05),

  // Ceiling for a ride-search page. A larger `limit` is silently clamped to
  // this rather than rejected — a client asking for too many is not an error.
  RIDE_SEARCH_MAX_LIMIT: z.coerce.number().int().positive().default(50),

  // How long a PENDING_PAYMENT booking holds its seats before the seat-hold
  // expiry job releases them if payment never completes. 900s (15 minutes) is
  // the documented default.
  BOOKING_PAYMENT_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // No safe fallback exists for a real payment gateway, same as Cloudinary —
  // left optional for local development without a Razorpay account;
  // RazorpayProvider is only ever constructed once both are present, and
  // StubPaymentProvider (fake order ids, no money moves) is used otherwise.
  PAYMENT_PROVIDER_KEY: z.string().optional(),
  PAYMENT_PROVIDER_SECRET: z.string().optional(),
  // A separate credential from the pair above — Razorpay signs its webhook
  // deliveries with its own secret, distinct from the account's API key.
  // Used by both providers' verifyWebhookSignature, since local testing
  // without a Razorpay account should still exercise genuine HMAC-SHA256
  // verification, never a stand-in.
  PAYMENT_PROVIDER_WEBHOOK_SECRET: z.string().optional(),
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

  const { data } = parsed;

  // Zod validates each var in isolation; a min bound greater than its own max
  // bound is a cross-field mistake no single-field rule can catch, and would
  // silently clamp every fare to one end of the range instead of failing loud.
  if (data.FARE_TRAFFIC_MULTIPLIER_MIN > data.FARE_TRAFFIC_MULTIPLIER_MAX) {
    throw new AppError({
      statusCode: 500,
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      message: 'FARE_TRAFFIC_MULTIPLIER_MIN must not exceed FARE_TRAFFIC_MULTIPLIER_MAX.',
    });
  }

  if (data.FARE_RATING_MULTIPLIER_MIN > data.FARE_RATING_MULTIPLIER_MAX) {
    throw new AppError({
      statusCode: 500,
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      message: 'FARE_RATING_MULTIPLIER_MIN must not exceed FARE_RATING_MULTIPLIER_MAX.',
    });
  }

  return data;
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
  maps: {
    provider: env.MAP_PROVIDER,
    geoapifyApiKey: env.MAP_PROVIDER_API_KEY,
  },
  fare: {
    baseFare: env.FARE_BASE_FARE,
    pricePerKm: env.FARE_PRICE_PER_KM,
    vehicleMultipliers: {
      HATCHBACK: env.FARE_VEHICLE_MULTIPLIER_HATCHBACK,
      SEDAN: env.FARE_VEHICLE_MULTIPLIER_SEDAN,
      MUV: env.FARE_VEHICLE_MULTIPLIER_MUV,
      SUV: env.FARE_VEHICLE_MULTIPLIER_SUV,
    },
    trafficMultiplierMin: env.FARE_TRAFFIC_MULTIPLIER_MIN,
    trafficMultiplierMax: env.FARE_TRAFFIC_MULTIPLIER_MAX,
    ratingMultiplierMin: env.FARE_RATING_MULTIPLIER_MIN,
    ratingMultiplierMax: env.FARE_RATING_MULTIPLIER_MAX,
  },
  rideSearch: {
    maxLimit: env.RIDE_SEARCH_MAX_LIMIT,
  },
  booking: {
    paymentTtlSeconds: env.BOOKING_PAYMENT_TTL_SECONDS,
  },
  payments: {
    providerKey: env.PAYMENT_PROVIDER_KEY,
    providerSecret: env.PAYMENT_PROVIDER_SECRET,
    webhookSecret: env.PAYMENT_PROVIDER_WEBHOOK_SECRET,
  },
} as const;

export type Config = typeof config;
