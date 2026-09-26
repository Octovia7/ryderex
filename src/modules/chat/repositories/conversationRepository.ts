import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'conversation'>;

export interface ConversationRecord {
  id: string;
  rideId: string;
  driverId: string;
  passengerId: string;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = {
  id: true,
  rideId: true,
  driverId: true,
  passengerId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface UpsertConversationData {
  id: string;
  rideId: string;
  driverId: string;
  passengerId: string;
}

// Idempotent by the `(rideId, passengerId)` unique constraint (architecture.md
// §6 / claude.md §5: "unique constraint as arbiter") — a second booking by
// the same passenger on the same ride reuses the existing row rather than
// racing a check-then-insert. The `update` branch is deliberately empty, the
// same shape as notificationRepository.upsert: a retry that finds the row
// already there changes nothing.
export function upsert(client: Client, data: UpsertConversationData): Promise<ConversationRecord> {
  return client.conversation.upsert({
    where: { rideId_passengerId: { rideId: data.rideId, passengerId: data.passengerId } },
    create: data,
    update: {},
    select: SELECT,
  });
}

// The gateway's and the REST history endpoint's shared authorization lookup
// — a plain by-id read; deciding whether the caller is a participant is the
// service's job, not this repository's.
export function findById(client: Client, id: string): Promise<ConversationRecord | null> {
  return client.conversation.findUnique({ where: { id }, select: SELECT });
}

export interface ConversationListRow extends ConversationRecord {
  driver: { id: string; name: string };
  passenger: { id: string; name: string };
}

export interface FindByUserIdParams {
  userId: string;
  limit: number;
  // The keyset position of the last row on a previous page — same
  // (value, id) idea as notifications/ride search.
  after?: { createdAt: Date; id: string };
}

// Newest-first, keyset-paginated: every conversation where the caller is
// EITHER side (driver or passenger). `driver`/`passenger` are joined in
// (not a second query per row) so the service can derive each one's
// `counterpart` without an extra round trip per conversation.
export function findByUserId(
  client: Client,
  params: FindByUserIdParams,
): Promise<ConversationListRow[]> {
  return client.conversation.findMany({
    where: {
      AND: [
        { OR: [{ driverId: params.userId }, { passengerId: params.userId }] },
        ...(params.after
          ? [
              {
                OR: [
                  { createdAt: { lt: params.after.createdAt } },
                  { createdAt: params.after.createdAt, id: { lt: params.after.id } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit,
    select: {
      ...SELECT,
      driver: { select: { id: true, name: true } },
      passenger: { select: { id: true, name: true } },
    },
  });
}
