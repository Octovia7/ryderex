import { prisma } from '../../../infrastructure/database/prismaClient';
import type { NotificationType } from '../../../generated/prisma/enums';
import { AppError } from '../../../shared/AppError';
import * as notificationRepository from '../repositories/notificationRepository';
import type { NotificationRecord } from '../repositories/notificationRepository';
import type { ListNotificationsQuery } from '../schemas/listNotifications.schema';
import { decodeNotificationCursor, encodeNotificationCursor } from './notificationCursor';

// A page above this is clamped, never rejected — same shape as ride search's
// own ceiling, just a local constant rather than an env-configurable one
// (nothing in the canonical docs calls for that surface here).
const MAX_LIMIT = 50;

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationDto[];
  // Opaque; hand it back verbatim as `cursor` to get the next page. null when
  // this is the last page.
  nextCursor: string | null;
}

function toNotificationDto(row: NotificationRecord): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function notificationNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'NOTIFICATION_NOT_FOUND',
    message: 'Notification not found.',
  });
}

// Newest-first, keyset-paginated, scoped to the caller's own notifications
// only (steps.md §13). `userId` comes from the authenticated session, never
// a query/body parameter, so this can never return another user's rows.
export async function listNotifications(
  userId: string,
  query: ListNotificationsQuery,
): Promise<NotificationPage> {
  const after = query.cursor === undefined ? null : decodeNotificationCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIMIT);

  // One row more than the page: if it comes back, another page exists — no
  // second COUNT(*) query needed to know (same trick as rideSearchService).
  const rows = await notificationRepository.findByUserId(prisma, {
    userId,
    limit: limit + 1,
    after: after ?? undefined,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor =
    rows.length > limit && lastRow
      ? encodeNotificationCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;

  return { items: pageRows.map(toNotificationDto), nextCursor };
}

// Idempotent (steps.md §13): re-marking an already-read notification returns
// its existing `readAt` rather than erroring. "Exists but isn't yours" and
// "doesn't exist" are indistinguishable — both 404 — so a foreign id can
// never be probed for by trying to mark it read.
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<NotificationDto> {
  const notification = await notificationRepository.findById(prisma, notificationId);

  if (!notification || notification.userId !== userId) {
    throw notificationNotFound();
  }

  // `markRead` is a conditional UPDATE, valid only from unread — a no-op here
  // means either this notification was already read, or a concurrent
  // markRead call won the race. Either way, re-fetching afterwards (rather
  // than trusting this call's own before/after state) is what makes the
  // response correct in both cases: the row's current `readAt` is always
  // authoritative.
  await notificationRepository.markRead(prisma, notificationId, userId);
  const updated = await notificationRepository.findById(prisma, notificationId);

  if (!updated) {
    throw notificationNotFound();
  }

  return toNotificationDto(updated);
}
