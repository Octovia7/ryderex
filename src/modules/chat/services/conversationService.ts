import { randomUUID } from 'node:crypto';
import { prisma } from '../../../infrastructure/database/prismaClient';
import { AppError } from '../../../shared/AppError';
import * as conversationRepository from '../repositories/conversationRepository';
import type { ConversationRecord } from '../repositories/conversationRepository';
import * as messageRepository from '../repositories/messageRepository';
import type { ListConversationsQuery } from '../schemas/listConversations.schema';
import type { ListMessagesQuery } from '../schemas/listMessages.schema';
import { decodeChatCursor, encodeChatCursor } from './chatCursor';

// A page above this is clamped, never rejected — same shape as every other
// cursor-paginated list in this codebase.
const MAX_LIMIT = 50;

export interface CounterpartDto {
  id: string;
  name: string;
}

export interface MessagePreviewDto {
  id: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

export interface ConversationDto {
  id: string;
  rideId: string;
  counterpart: CounterpartDto;
  lastMessage: MessagePreviewDto | null;
  createdAt: Date;
}

export interface ConversationPage {
  items: ConversationDto[];
  nextCursor: string | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface MessagePage {
  items: MessageDto[];
  nextCursor: string | null;
}

function conversationNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'CONVERSATION_NOT_FOUND',
    message: 'Conversation not found.',
  });
}

function toMessageDto(row: {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    content: row.content,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

// Lazy creation (steps.md §14): called by bookingService.createBooking the
// first time a given passenger has a reason to talk to the ride's driver —
// not gated on booking/payment status, either party may reasonably want to
// talk before payment confirms. Idempotent via the (rideId, passengerId)
// unique constraint: a second booking by the same passenger on the same
// ride reuses the existing row rather than racing a check-then-insert.
export function getOrCreateConversationForRide(
  rideId: string,
  driverId: string,
  passengerId: string,
): Promise<ConversationRecord> {
  return conversationRepository.upsert(prisma, {
    id: randomUUID(),
    rideId,
    driverId,
    passengerId,
  });
}

// Shared by the REST history endpoint AND the socket gateway's
// `join_conversation`/`send_message` handlers (claude.md §7: "re-checked on
// every send_message, not only on join"). "Exists but isn't yours" and
// "doesn't exist" are indistinguishable — both 404 CONVERSATION_NOT_FOUND,
// never 403 — so a valid id can never be probed for.
export async function authorizeParticipant(
  userId: string,
  conversationId: string,
): Promise<ConversationRecord> {
  const conversation = await conversationRepository.findById(prisma, conversationId);

  if (!conversation || (conversation.driverId !== userId && conversation.passengerId !== userId)) {
    throw conversationNotFound();
  }

  return conversation;
}

// Newest-first, keyset-paginated, scoped to every conversation where the
// caller is EITHER side. `counterpart` is derived per row from whichever of
// driver/passenger is NOT the caller — never a client-supplied identity.
export async function listConversations(
  userId: string,
  query: ListConversationsQuery,
): Promise<ConversationPage> {
  const after = query.cursor === undefined ? null : decodeChatCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIMIT);

  // One row more than the page: if it comes back, another page exists — no
  // second COUNT(*) query needed to know.
  const rows = await conversationRepository.findByUserId(prisma, {
    userId,
    limit: limit + 1,
    after: after ?? undefined,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor =
    rows.length > limit && lastRow
      ? encodeChatCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;

  const latestMessages = await messageRepository.findLatestByConversationIds(
    prisma,
    pageRows.map((row) => row.id),
  );
  const latestByConversationId = new Map(latestMessages.map((row) => [row.conversationId, row]));

  return {
    items: pageRows.map((row) => {
      const counterpart = row.driverId === userId ? row.passenger : row.driver;
      const lastMessage = latestByConversationId.get(row.id) ?? null;

      return {
        id: row.id,
        rideId: row.rideId,
        counterpart: { id: counterpart.id, name: counterpart.name },
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              senderId: lastMessage.senderId,
              content: lastMessage.content,
              createdAt: lastMessage.createdAt,
            }
          : null,
        createdAt: row.createdAt,
      };
    }),
    nextCursor,
  };
}

// Cursor-paginated message history for one conversation — REST, read-only.
// Sending stays WebSocket-only (steps.md §14: "no REST POST-message
// endpoint exists").
export async function listMessages(
  userId: string,
  conversationId: string,
  query: ListMessagesQuery,
): Promise<MessagePage> {
  await authorizeParticipant(userId, conversationId);

  const after = query.cursor === undefined ? null : decodeChatCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIMIT);

  const rows = await messageRepository.findByConversationId(prisma, {
    conversationId,
    limit: limit + 1,
    after: after ?? undefined,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor =
    rows.length > limit && lastRow
      ? encodeChatCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;

  return { items: pageRows.map(toMessageDto), nextCursor };
}

// The socket gateway's own write path — the only place a Message is ever
// created (no REST equivalent exists). Authorization is re-checked here
// too, never trusted from a prior `join_conversation` (claude.md §7).
export async function sendMessage(
  userId: string,
  conversationId: string,
  content: string,
): Promise<MessageDto> {
  await authorizeParticipant(userId, conversationId);

  const message = await messageRepository.create(prisma, {
    id: randomUUID(),
    conversationId,
    senderId: userId,
    content,
  });

  return toMessageDto(message);
}
