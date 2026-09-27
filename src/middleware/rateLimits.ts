import { config } from '../config';
import { rateLimit } from '../infrastructure/redis/rateLimit';

// The one limit shared by two modules (architecture.md §15: "document
// upload (shared bucket across both upload endpoints)") — vehicle document
// upload and the driver-licence application upload both draw from this
// SAME middleware instance, so the same `prefix` produces the same Redis
// key per user regardless of which endpoint they call, and a user can't
// get double the allowance by alternating between them.
export const documentUploadRateLimit = rateLimit({
  prefix: 'document-upload',
  keyBy: 'user',
  windowSeconds: 86_400,
  max: config.rateLimits.documentUploadPerDay,
});
