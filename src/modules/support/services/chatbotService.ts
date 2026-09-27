import { randomUUID } from 'node:crypto';
import { config } from '../../../config';
import { aiProvider } from '../../../infrastructure/ai';
import type { AIMessage, AIMessageRole } from '../../../infrastructure/ai';
import { prisma } from '../../../infrastructure/database/prismaClient';
import { checkRateLimit } from '../../../infrastructure/redis/rateLimit';
import { AppError } from '../../../shared/AppError';
import * as supportConversationRepository from '../repositories/supportConversationRepository';
import type { SupportConversationRecord } from '../repositories/supportConversationRepository';
import * as supportMessageRepository from '../repositories/supportMessageRepository';
import type { SupportMessageRecord } from '../repositories/supportMessageRepository';
import type { ListSupportConversationsQuery } from '../schemas/listSupportConversations.schema';
import type { ListSupportMessagesQuery } from '../schemas/listSupportMessages.schema';
import { decodeSupportCursor, encodeSupportCursor } from './supportCursor';
import { buildSupportSystemPrompt } from './supportPrompt';
import { executeToolCall, SUPPORT_TOOLS } from './supportToolService';

const MAX_LIST_LIMIT = 50;

function conversationNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'SUPPORT_CONVERSATION_NOT_FOUND',
    message: 'Support conversation not found.',
  });
}

export interface SupportConversationDto {
  id: string;
  status: SupportConversationRecord['status'];
  lastMessageAt: Date;
  createdAt: Date;
}

export interface SupportMessageDto {
  id: string;
  role: SupportMessageRecord['role'];
  status: SupportMessageRecord['status'];
  content: string | null;
  totalTokens: number | null;
  createdAt: Date;
}

export interface SupportConversationPage {
  items: SupportConversationDto[];
  nextCursor: string | null;
}

export interface SupportMessagePage {
  items: SupportMessageDto[];
  nextCursor: string | null;
}

export interface SupportConversationDetailDto extends SupportConversationDto {
  messages: SupportMessagePage;
}

function toConversationDto(row: SupportConversationRecord): SupportConversationDto {
  return {
    id: row.id,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
  };
}

function toMessageDto(row: SupportMessageRecord): SupportMessageDto {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    content: row.content,
    totalTokens: row.totalTokens,
    createdAt: row.createdAt,
  };
}

// SYSTEM is a schema-only concession to a future persisted system message
// (mirroring SupportConversationStatus.RESOLVED/ESCALATED — a value the
// schema supports without a workflow that produces it yet); nothing
// creates one today. Mapped to 'user' defensively, never to 'tool' (which
// would require a toolCallId that a SYSTEM row would never carry).
function toAIRole(role: SupportMessageRecord['role']): AIMessageRole {
  if (role === 'ASSISTANT') return 'assistant';
  if (role === 'TOOL') return 'tool';
  return 'user';
}

function toAIMessage(row: SupportMessageRecord): AIMessage {
  return {
    role: toAIRole(row.role),
    content: row.content ?? undefined,
    toolCalls: row.toolCalls ?? undefined,
    toolCallId: row.toolCallId ?? undefined,
  };
}

// Created empty — sending the first message is a separate, later call
// (steps.md §14's chat module follows the identical shape: a conversation
// resource is created, messages are posted to it afterward).
export async function createConversation(userId: string): Promise<SupportConversationDto> {
  const conversation = await supportConversationRepository.create(prisma, {
    id: randomUUID(),
    userId,
  });
  return toConversationDto(conversation);
}

// Most-recently-active first — scoped to the caller's own conversations
// only (never another user's, the same 404-not-403 posture as everywhere
// else in this codebase).
export async function listConversations(
  userId: string,
  query: ListSupportConversationsQuery,
): Promise<SupportConversationPage> {
  const after = query.cursor === undefined ? null : decodeSupportCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIST_LIMIT);

  const rows = await supportConversationRepository.findByUserId(prisma, {
    userId,
    limit: limit + 1,
    after: after ? { lastMessageAt: after.value, id: after.id } : undefined,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > limit && lastRow
      ? encodeSupportCursor({ value: lastRow.lastMessageAt, id: lastRow.id })
      : null;

  return { items: pageRows.map(toConversationDto), nextCursor };
}

// No separate messages-history endpoint exists (unlike chat) — this single
// GET returns the conversation's own metadata plus its cursor-paginated
// message history embedded, newest-first.
export async function getConversation(
  userId: string,
  conversationId: string,
  query: ListSupportMessagesQuery,
): Promise<SupportConversationDetailDto> {
  const conversation = await supportConversationRepository.findById(prisma, conversationId);

  if (!conversation || conversation.userId !== userId) {
    throw conversationNotFound();
  }

  const after = query.cursor === undefined ? null : decodeSupportCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIST_LIMIT);

  const rows = await supportMessageRepository.findByConversationId(prisma, {
    conversationId,
    limit: limit + 1,
    after: after ? { createdAt: after.value, id: after.id } : undefined,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > limit && lastRow
      ? encodeSupportCursor({ value: lastRow.createdAt, id: lastRow.id })
      : null;

  return {
    ...toConversationDto(conversation),
    messages: { items: pageRows.map(toMessageDto), nextCursor },
  };
}

// Reuses the existing Redis rate-limit infrastructure (the same
// `checkRateLimit` call shape otpService already uses, never a new
// limiter) — per-user, two independent windows (architecture.md §17:
// "10/min + 50/day").
async function assertWithinRateLimit(userId: string): Promise<void> {
  const perMinute = await checkRateLimit(
    `ratelimit:support-chat-min:${userId}`,
    60,
    config.supportChat.rateLimitPerMinute,
  );

  if (!perMinute.allowed) {
    throw new AppError({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many messages. Please wait a moment before trying again.',
    });
  }

  const perDay = await checkRateLimit(
    `ratelimit:support-chat-day:${userId}`,
    86_400,
    config.supportChat.rateLimitPerDay,
  );

  if (!perDay.allowed) {
    throw new AppError({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: "You've reached today's message limit. Please try again tomorrow.",
    });
  }
}

// The bounded tool-calling loop (architecture.md §17's sequence diagram).
// The user's message is persisted BEFORE any provider call — a provider
// failure must never lose what they typed. Runs at most
// `SUPPORT_CHAT_MAX_TOOL_ROUNDS` rounds with tools offered, plus exactly one
// final completion with tools WITHHELD if the budget is exhausted without a
// final text answer — the model must answer from what is already in
// context rather than the request being blamed on the provider.
export async function sendMessage(
  userId: string,
  conversationId: string,
  content: string,
): Promise<SupportMessageDto[]> {
  await assertWithinRateLimit(userId);

  const conversation = await supportConversationRepository.findById(prisma, conversationId);

  if (!conversation || conversation.userId !== userId) {
    throw conversationNotFound();
  }

  const userMessage = await supportMessageRepository.create(prisma, {
    id: randomUUID(),
    conversationId,
    role: 'USER',
    content,
  });
  await supportConversationRepository.touchLastMessageAt(prisma, conversationId);

  const created: SupportMessageRecord[] = [userMessage];
  const systemInstruction = buildSupportSystemPrompt();
  const maxRounds = config.supportChat.maxToolRounds;

  try {
    for (let round = 0; round <= maxRounds; round++) {
      const withTools = round < maxRounds;

      const history = await supportMessageRepository.findRecentForContext(
        prisma,
        conversationId,
        config.supportChat.historyLimit,
      );

      const result = await aiProvider.complete({
        systemInstruction,
        messages: history.map(toAIMessage),
        tools: withTools ? SUPPORT_TOOLS : undefined,
      });

      if (result.type === 'text') {
        const assistantRow = await supportMessageRepository.create(prisma, {
          id: randomUUID(),
          conversationId,
          role: 'ASSISTANT',
          content: result.content,
          totalTokens: result.totalTokens,
        });
        created.push(assistantRow);
        await supportConversationRepository.touchLastMessageAt(prisma, conversationId);
        return created.map(toMessageDto);
      }

      const assistantRow = await supportMessageRepository.create(prisma, {
        id: randomUUID(),
        conversationId,
        role: 'ASSISTANT',
        toolCalls: result.toolCalls,
        totalTokens: result.totalTokens,
      });
      created.push(assistantRow);

      if (!withTools) {
        // Defensive only — tools were withheld this round, so the provider
        // should never return tool_calls here.
        break;
      }

      for (const call of result.toolCalls) {
        const toolResult = await executeToolCall(userId, call);
        const toolRow = await supportMessageRepository.create(prisma, {
          id: randomUUID(),
          conversationId,
          role: 'TOOL',
          content: JSON.stringify(toolResult),
          toolCallId: call.id,
        });
        created.push(toolRow);
      }
    }

    await supportConversationRepository.touchLastMessageAt(prisma, conversationId);
    return created.map(toMessageDto);
  } catch (error) {
    // The user's own message (and any completed tool round) stays
    // persisted regardless — only the failed turn's own reply is missing.
    // Persisted as its own FAILED row, per architecture.md §17, rather than
    // silently dropped.
    await supportMessageRepository.create(prisma, {
      id: randomUUID(),
      conversationId,
      role: 'ASSISTANT',
      status: 'FAILED',
    });
    await supportConversationRepository.touchLastMessageAt(prisma, conversationId);
    throw error;
  }
}
