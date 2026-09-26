import { prisma } from '../../../infrastructure/database/prismaClient';
import type { NotificationType } from '../../../generated/prisma/enums';

type Client = Pick<typeof prisma, 'notification'>;

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = {
  id: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface UpsertNotificationData {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
}

// Idempotent by `id` — the delivery worker's own persistence step
// (architecture.md §15: "the row is upserted by a UUID minted at *enqueue*
// time... so retries are idempotent"). The `update` branch is deliberately
// empty: a retry that finds the row already there changes nothing, it does
// not re-derive or overwrite title/body/type from a possibly-different
// payload.
export function upsert(client: Client, data: UpsertNotificationData): Promise<NotificationRecord> {
  return client.notification.upsert({
    where: { id: data.id },
    create: data,
    update: {},
    select: SELECT,
  });
}

export function findById(client: Client, id: string): Promise<NotificationRecord | null> {
  return client.notification.findUnique({ where: { id }, select: SELECT });
}

export interface FindByUserIdParams {
  userId: string;
  limit: number;
  // The keyset position of the last row on a previous page — the same
  // (value, id) idea as ride search's cursor, but fixed to one sort
  // (newest-first) rather than five, so no separate value-type validation
  // is needed here the way rideSearchCursor.ts needs one per sort.
  after?: { createdAt: Date; id: string };
}

// Newest-first, keyset-paginated (architecture.md §6: "(user_id,
// created_at) let the cursor's tuple comparison walk the index directly").
// `id` is the tie-breaker for rows sharing a `createdAt` millisecond.
export function findByUserId(
  client: Client,
  params: FindByUserIdParams,
): Promise<NotificationRecord[]> {
  return client.notification.findMany({
    where: {
      userId: params.userId,
      ...(params.after
        ? {
            OR: [
              { createdAt: { lt: params.after.createdAt } },
              { createdAt: params.after.createdAt, id: { lt: params.after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit,
    select: SELECT,
  });
}

// Conditional UPDATE: valid only from unread (`readAt: null`), so the guard
// and the write are one statement — the same idempotency-by-construction
// shape as every other terminal transition in this codebase. `count === 0`
// means either the notification is already read (a caller re-reads it to
// return the existing `readAt` rather than erroring) or it does not belong
// to this user / does not exist (a caller distinguishes those with its own
// read) — this repository only reports whether ITS write applied, never why.
export async function markRead(client: Client, id: string, userId: string): Promise<boolean> {
  const result = await client.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count === 1;
}
