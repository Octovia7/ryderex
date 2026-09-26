import { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'message'>;
type SqlClient = Pick<typeof prisma, '$queryRaw'>;

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

const SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  readAt: true,
  createdAt: true,
} as const;

export interface CreateMessageData {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
}

// Persisted, then (by the caller, the socket gateway) broadcast only to the
// `conversation:{id}` room — never the other way around. No conditional
// UPDATE is needed here: unlike a state transition, sending a message has no
// "already done" race to arbitrate — every send is a new row.
export function create(client: Client, data: CreateMessageData): Promise<MessageRecord> {
  return client.message.create({ data, select: SELECT });
}

export interface FindByConversationIdParams {
  conversationId: string;
  limit: number;
  after?: { createdAt: Date; id: string };
}

// Newest-first, keyset-paginated — the same (createdAt, id) tie-break shape
// as every other cursor-paginated list in this codebase. Authorization
// (is the caller a participant of this conversation) is the service's job,
// not this repository's — it is handed a conversationId already vetted.
export function findByConversationId(
  client: Client,
  params: FindByConversationIdParams,
): Promise<MessageRecord[]> {
  return client.message.findMany({
    where: {
      conversationId: params.conversationId,
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

export interface LatestMessageRow {
  conversationId: string;
  id: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

// The conversation list's "lastMessage preview" — one query for the latest
// message in each of several conversations, rather than a per-row N+1.
// Prisma's query builder has no "latest per group" primitive, so this is the
// one place this module reaches for raw SQL (confined here, the same
// discipline rideRepository's geography queries follow) — `DISTINCT ON` is
// PostgreSQL's native way to express it. Every interpolated value is still a
// bound parameter via Prisma.sql/Prisma.join, never string concatenation.
export async function findLatestByConversationIds(
  client: SqlClient,
  conversationIds: string[],
): Promise<LatestMessageRow[]> {
  if (conversationIds.length === 0) {
    return [];
  }

  return client.$queryRaw<LatestMessageRow[]>(Prisma.sql`
    SELECT DISTINCT ON (conversation_id)
      conversation_id AS "conversationId",
      id,
      sender_id AS "senderId",
      content,
      created_at AS "createdAt"
    FROM messages
    WHERE conversation_id IN (${Prisma.join(conversationIds)})
    ORDER BY conversation_id, created_at DESC, id DESC
  `);
}
