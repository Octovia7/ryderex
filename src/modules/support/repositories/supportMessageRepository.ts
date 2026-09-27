import type { Prisma } from '../../../generated/prisma/client';
import type { SupportMessageRole, SupportMessageStatus } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'supportMessage'>;

// The shape `toolCalls` is persisted as (a JSON array), mirroring
// AIToolCall exactly — never re-derived or re-typed at the boundary.
export interface StoredToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  providerState?: string;
}

export interface SupportMessageRecord {
  id: string;
  conversationId: string;
  role: SupportMessageRole;
  status: SupportMessageStatus;
  content: string | null;
  toolCalls: StoredToolCall[] | null;
  toolCallId: string | null;
  totalTokens: number | null;
  createdAt: Date;
}

const SELECT = {
  id: true,
  conversationId: true,
  role: true,
  status: true,
  content: true,
  toolCalls: true,
  toolCallId: true,
  totalTokens: true,
  createdAt: true,
} as const;

function toRecord(row: {
  id: string;
  conversationId: string;
  role: SupportMessageRole;
  status: SupportMessageStatus;
  content: string | null;
  toolCalls: unknown;
  toolCallId: string | null;
  totalTokens: number | null;
  createdAt: Date;
}): SupportMessageRecord {
  return { ...row, toolCalls: (row.toolCalls as StoredToolCall[] | null) ?? null };
}

export interface CreateSupportMessageData {
  id: string;
  conversationId: string;
  role: SupportMessageRole;
  status?: SupportMessageStatus;
  content?: string | null;
  toolCalls?: StoredToolCall[];
  toolCallId?: string;
  totalTokens?: number;
}

// Every turn-participant row — user, assistant, or tool — goes through this
// one function, never edited after creation (architecture.md §17: the
// user's message is persisted BEFORE any provider call, and a failed
// assistant turn is persisted too, as its own FAILED row).
export async function create(
  client: Client,
  data: CreateSupportMessageData,
): Promise<SupportMessageRecord> {
  const row = await client.supportMessage.create({
    data: {
      id: data.id,
      conversationId: data.conversationId,
      role: data.role,
      status: data.status,
      content: data.content ?? null,
      toolCalls: data.toolCalls as Prisma.InputJsonValue | undefined,
      toolCallId: data.toolCallId,
      totalTokens: data.totalTokens,
    },
    select: SELECT,
  });

  return toRecord(row);
}

export interface FindByConversationIdParams {
  conversationId: string;
  limit: number;
  after?: { createdAt: Date; id: string };
}

// Newest-first, keyset-paginated — the same (createdAt, id) tie-break shape
// as chat's own message history. Authorization is the service's job, not
// this repository's.
export async function findByConversationId(
  client: Client,
  params: FindByConversationIdParams,
): Promise<SupportMessageRecord[]> {
  const rows = await client.supportMessage.findMany({
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

  return rows.map(toRecord);
}

// The chatbot loop's own history read — oldest-first (the order a
// conversation actually happened in, and the order the provider expects
// its turn history), capped at `limit` most-recent messages
// (architecture.md §17: "load last 20 messages").
export async function findRecentForContext(
  client: Client,
  conversationId: string,
  limit: number,
): Promise<SupportMessageRecord[]> {
  const rows = await client.supportMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: SELECT,
  });

  return rows.reverse().map(toRecord);
}
