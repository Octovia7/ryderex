import type { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../infrastructure/database/prismaClient';

export interface IdempotencyKeyRecord {
  id: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: Prisma.JsonValue | null;
}

const SELECT = {
  id: true,
  requestHash: true,
  responseStatus: true,
  responseBody: true,
} as const;

// The database arbitrator (architecture.md §11): `createMany({
// skipDuplicates: true })` against the `(user_id, key)` UNIQUE constraint,
// never a read-then-write — two concurrent requests with the same key
// cannot both get `count === 1`. The id is minted by the caller (not
// `@default(uuid())`'s own generation) so a winning claim already knows its
// own row's id without a second round-trip to re-fetch it.
export async function claim(
  id: string,
  userId: string,
  key: string,
  requestHash: string,
): Promise<boolean> {
  const result = await prisma.idempotencyKey.createMany({
    data: { id, userId, key, requestHash },
    skipDuplicates: true,
  });
  return result.count === 1;
}

// Read after a lost claim, to decide which of the three outcomes it is:
// a different `requestHash` under the same key (conflict), the same hash
// but no response yet (in progress), or the same hash with a response
// already persisted (replay).
export function findByUserAndKey(
  userId: string,
  key: string,
): Promise<IdempotencyKeyRecord | null> {
  return prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
    select: SELECT,
  });
}

// Fills in the response exactly once, after the handler has produced one —
// `responseStatus`/`responseBody` start null (still running) and this is the
// only place either is ever set. No conditional guard is needed here: this
// runs only for the request that itself won the claim above, so there is no
// concurrent writer to race against for the same row.
export async function complete(
  id: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id },
    data: { responseStatus, responseBody: responseBody as Prisma.InputJsonValue },
  });
}
