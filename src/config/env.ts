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

  // Push has a SAFE fallback, unlike Payment/Email (architecture.md §16):
  // left optional for local development without an FCM service account;
  // FirebasePushProvider is only ever constructed once all three are
  // present, and ConsolePushProvider (logs instead of sending) is used
  // otherwise — degraded, not a boot refusal, since nothing about auth,
  // rides, or payments depends on push actually working.
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  // Env vars can't hold a literal newline; FirebasePushProvider re-expands
  // the escaped `\n` sequences a `.env` file (or most secret managers) store
  // this kind of multi-line PEM value as, back into real ones.
  FCM_PRIVATE_KEY: z.string().optional(),

  // AI has the same "safe, degraded fallback" grade as Push (architecture.md
  // §16): only one implementation exists today, but the env var — rather
  // than a hard-coded choice — is what keeps the next provider swap a config
  // change, the same reasoning as MAP_PROVIDER.
  AI_PROVIDER: z.enum(['gemini']).default('gemini'),
  // Left optional for local development without a Gemini account;
  // GeminiProvider is only ever constructed when present, and
  // ConsoleAIProvider (a canned reply, no tool calls) is used otherwise —
  // degraded, not a boot refusal.
  GEMINI_API_KEY: z.string().optional(),
  // An alias, not a pinned version — `gemini-2.0-flash` was retired mid-
  // development, and the *lite* alias specifically carries a far more
  // generous free-tier daily quota than the flagship alias, which a support
  // bot doing simple FAQ/tool-lookup work does not need.
  GEMINI_MODEL: z.string().default('gemini-flash-lite-latest'),

  // Cost-control ceilings for the support chatbot (architecture.md §17):
  // message length, history window, bounded tool rounds, and provider
  // timeout. None of these is a business rule — they are technical bounds,
  // the same category as RIDE_SEARCH_MAX_LIMIT.
  SUPPORT_CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(2000),
  SUPPORT_CHAT_HISTORY_LIMIT: z.coerce.number().int().positive().default(20),
  SUPPORT_CHAT_MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(2),
  SUPPORT_CHAT_PROVIDER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(15),

  // Per-user (architecture.md §17: "10/min + 50/day") — reuses the existing
  // Redis rate-limit infrastructure (infrastructure/redis/rateLimit.ts), the
  // same call shape otpService already uses, not a new limiter.
  SUPPORT_CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  SUPPORT_CHAT_RATE_LIMIT_PER_DAY: z.coerce.number().int().positive().default(50),

  // Phase 14: every previously-uncovered category, each its own
  // `*_RATE_LIMIT_*` env var (architecture.md §15: "no second limiter was
  // introduced"), all consumed through the one shared `rateLimit()`/
  // `consumeRateLimit()` implementation. Keyed per user where the route is
  // authenticated, per IP otherwise.
  AUTH_REFRESH_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(60),
  RIDE_SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  // Implementation choice (not a canonical documented value) — a driver
  // posts rides far less often than searching for one.
  RIDE_CREATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  // Implementation choice (not a canonical documented value).
  BOOKING_CREATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  // Implementation choice (not a canonical documented value) — shared by
  // both document-upload endpoints (vehicle documents, driver-licence
  // application), one bucket, per user.
  DOCUMENT_UPLOAD_RATE_LIMIT_PER_DAY: z.coerce.number().int().positive().default(20),
  // Implementation choice, sized to the canonical requirement that this be
  // "deliberately high" — dropping a real payment webhook is far worse than
  // absorbing traffic.
  WEBHOOK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  WEBSOCKET_CONNECT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  WEBSOCKET_MESSAGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  // Implementation choice — the "generous catch-all bucket for
  // authenticated reads" (architecture.md §15) that applies to every
  // authenticated GET route with no more specific category of its own.
  AUTHENTICATED_READ_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
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

  // Phase 14 production-boot assertions (claude.md §11/§14: "Never commit
  // secrets" / "production-config assertions... refuses to boot with
  // NODE_ENV=production if a placeholder secret survives... or if
  // CORS_ORIGIN is localhost or a wildcard"). Schema validation alone
  // cannot catch these — every placeholder value here is well-formed, valid
  // input by Zod's own rules. Development is deliberately left alone.
  if (data.NODE_ENV === 'production') {
    // Matches this repo's actual .env.example placeholder
    // ("change-me-in-every-real-environment") as well as the literal
    // "changeme-" spelling, case-insensitively and hyphen-insensitively —
    // a literal-only match would silently miss the real placeholder text.
    const isPlaceholderSecret = (value: string): boolean =>
      value.toLowerCase().replace(/-/g, '').startsWith('changeme');

    if (isPlaceholderSecret(data.JWT_ACCESS_SECRET)) {
      throw new AppError({
        statusCode: 500,
        code: 'INVALID_ENVIRONMENT_CONFIGURATION',
        message: 'JWT_ACCESS_SECRET must not be the placeholder value in production.',
      });
    }

    // No separate "refresh secret" exists to compare against
    // JWT_ACCESS_SECRET in this codebase's actual design — refresh tokens
    // are random bytes stored as a SHA-256 hash, never JWTs (claude.md §7),
    // so there is no second signing secret this repo could ever set equal
    // to the access one. This assertion is intentionally not implemented
    // here; see the Phase 14 report for why.

    for (const origin of data.CORS_ORIGINS) {
      if (origin === '*') {
        throw new AppError({
          statusCode: 500,
          code: 'INVALID_ENVIRONMENT_CONFIGURATION',
          message: 'CORS_ORIGINS must not include a wildcard origin in production.',
        });
      }

      if (/localhost|127\.0\.0\.1/i.test(origin)) {
        throw new AppError({
          statusCode: 500,
          code: 'INVALID_ENVIRONMENT_CONFIGURATION',
          message: 'CORS_ORIGINS must not include a localhost origin in production.',
        });
      }
    }
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
  fcm: {
    projectId: env.FCM_PROJECT_ID,
    clientEmail: env.FCM_CLIENT_EMAIL,
    privateKey: env.FCM_PRIVATE_KEY,
  },
  ai: {
    provider: env.AI_PROVIDER,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
  },
  supportChat: {
    maxMessageLength: env.SUPPORT_CHAT_MAX_MESSAGE_LENGTH,
    historyLimit: env.SUPPORT_CHAT_HISTORY_LIMIT,
    maxToolRounds: env.SUPPORT_CHAT_MAX_TOOL_ROUNDS,
    providerTimeoutSeconds: env.SUPPORT_CHAT_PROVIDER_TIMEOUT_SECONDS,
    rateLimitPerMinute: env.SUPPORT_CHAT_RATE_LIMIT_PER_MINUTE,
    rateLimitPerDay: env.SUPPORT_CHAT_RATE_LIMIT_PER_DAY,
  },
  rateLimits: {
    authRefreshPerHour: env.AUTH_REFRESH_RATE_LIMIT_PER_HOUR,
    rideSearchPerMinute: env.RIDE_SEARCH_RATE_LIMIT_PER_MINUTE,
    rideCreationPerMinute: env.RIDE_CREATION_RATE_LIMIT_PER_MINUTE,
    bookingCreationPerMinute: env.BOOKING_CREATION_RATE_LIMIT_PER_MINUTE,
    documentUploadPerDay: env.DOCUMENT_UPLOAD_RATE_LIMIT_PER_DAY,
    webhookPerMinute: env.WEBHOOK_RATE_LIMIT_PER_MINUTE,
    websocketConnectPerMinute: env.WEBSOCKET_CONNECT_RATE_LIMIT_PER_MINUTE,
    websocketMessagePerMinute: env.WEBSOCKET_MESSAGE_RATE_LIMIT_PER_MINUTE,
    authenticatedReadPerMinute: env.AUTHENTICATED_READ_RATE_LIMIT_PER_MINUTE,
  },
} as const;

export type Config = typeof config;
