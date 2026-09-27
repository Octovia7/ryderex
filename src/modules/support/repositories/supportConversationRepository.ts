import { prisma } from '../../../infrastructure/database/prismaClient';
import type { SupportConversationStatus } from '../../../generated/prisma/enums';

type Client = Pick<typeof prisma, 'supportConversation'>;

export interface SupportConversationRecord {
  id: string;
  userId: string;
  status: SupportConversationStatus;
  escalationReason: string | null;
  escalatedAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = {
  id: true,
  userId: true,
  status: true,
  escalationReason: true,
  escalatedAt: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CreateSupportConversationData {
  id: string;
  userId: string;
}

// A new conversation always starts OPEN with no messages — created
// separately from the REST resource, `POST /support/conversations` has no
// body: sending the first message is a later, distinct call.
export function create(
  client: Client,
  data: CreateSupportConversationData,
): Promise<SupportConversationRecord> {
  return client.supportConversation.create({ data, select: SELECT });
}

// The ownership-check lookup — a plain by-id read; deciding whether the
// caller may see it is the service's job, not this repository's.
export function findById(client: Client, id: string): Promise<SupportConversationRecord | null> {
  return client.supportConversation.findUnique({ where: { id }, select: SELECT });
}

export interface FindByUserIdParams {
  userId: string;
  limit: number;
  after?: { lastMessageAt: Date; id: string };
}

// Most-recently-active first (`lastMessageAt`, not `createdAt` — unlike
// every other cursor-paginated list in this codebase, matching
// architecture.md's own index: "support_conversations(user_id,
// last_message_at)").
export function findByUserId(
  client: Client,
  params: FindByUserIdParams,
): Promise<SupportConversationRecord[]> {
  return client.supportConversation.findMany({
    where: {
      userId: params.userId,
      ...(params.after
        ? {
            OR: [
              { lastMessageAt: { lt: params.after.lastMessageAt } },
              { lastMessageAt: params.after.lastMessageAt, id: { lt: params.after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: params.limit,
    select: SELECT,
  });
}

// Bumped every time a new message is persisted in this conversation — the
// one write this repository does beyond create/read.
export function touchLastMessageAt(client: Client, id: string): Promise<void> {
  return client.supportConversation
    .update({ where: { id }, data: { lastMessageAt: new Date() }, select: { id: true } })
    .then(() => undefined);
}
