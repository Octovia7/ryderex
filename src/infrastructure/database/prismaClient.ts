import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { config } from '../../config';

const pool = new Pool({ connectionString: config.database.url });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
