import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { config } from '../../config';

// Phase 16: `max` was previously left unset (the `pg` library's own default
// of 10 applied implicitly). Explicit now via `DATABASE_POOL_MAX`, so a
// hosted Postgres plan's connection cap is a config change, not a guess.
const pool = new Pool({ connectionString: config.database.url, max: config.database.poolMax });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
