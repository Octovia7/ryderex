import 'dotenv/config';
import { z } from 'zod';
import { AppError } from '../utils/AppError';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // Populated in later phases. Kept optional so Phase 0 can start without them.
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().optional(),
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
  corsOrigins: env.CORS_ORIGINS,
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
  },
} as const;

export type Config = typeof config;
