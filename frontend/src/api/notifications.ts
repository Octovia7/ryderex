import { apiFetch } from './client';

// Verified against prisma/schema.prisma's NotificationType enum and
// docs/architecture.md's own count ("9 producers") — both agree exactly.
export const NOTIFICATION_TYPES = [
  'RIDE_BOOKED',
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'RIDE_CANCELLED',
  'RIDE_STARTING',
  'RIDE_COMPLETED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'REFUND_PROCESSED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Verified against src/modules/notification/services/notificationQueryService.ts's
// NotificationDto. `readAt` is null for unread; set once, to the first
// read — the column itself never un-reads a notification.
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: Notification[];
  // Opaque; hand it back verbatim as `cursor` to get the next page. null
  // when this is the last page.
  nextCursor: string | null;
}

export interface ListNotificationsParams {
  limit?: number;
  cursor?: string;
}

// GET /api/v1/notifications — no role gate server-side; scoped to the
// caller's own notifications in the service
// (notificationQueryService.listNotifications). Newest-first, keyset-
// paginated — the same cursor/limit query contract GET /bookings and
// GET /rides/:id/bookings already use.
export function listNotifications(
  params: ListNotificationsParams = {},
  accessToken?: string | null,
): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();

  return apiFetch(`/notifications${qs ? `?${qs}` : ''}`, { accessToken });
}

// PATCH /api/v1/notifications/:id/read — ownership-scoped in the service
// (404 NOTIFICATION_NOT_FOUND for anyone else, same IDOR convention as
// every other resource here). Idempotent: re-marking an already-read
// notification is a no-op, not an error — the response always reflects the
// row's actual current readAt, never an assumption. No body.
export function markNotificationRead(
  notificationId: string,
  accessToken?: string | null,
): Promise<Notification> {
  return apiFetch(`/notifications/${notificationId}/read`, { method: 'PATCH', accessToken });
}
