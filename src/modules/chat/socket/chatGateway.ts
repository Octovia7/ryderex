import type { ChatServer } from '../../../infrastructure/socket/socketServer';
import { AppError } from '../../../shared/AppError';
import { joinConversationSchema } from '../schemas/joinConversation.schema';
import { sendMessageSchema } from '../schemas/sendMessage.schema';
import * as conversationService from '../services/conversationService';
import type { MessageDto } from '../services/conversationService';

// The Socket.IO ack shape deliberately mirrors the REST envelope exactly
// (claude.md §12: `{success,data}` / `{success,error:{code,message}}`) —
// one consistent success/error vocabulary across both transports, rather
// than inventing a second one. `data` is omitted on success where there is
// nothing meaningful to return (`join_conversation`).
type AckResponse<T> =
  { success: true; data?: T } | { success: false; error: { code: string; message: string } };
type Ack<T = undefined> = (response: AckResponse<T>) => void;

function ackError<T>(ack: Ack<T> | undefined, error: unknown): void {
  if (!ack) {
    return;
  }

  if (error instanceof AppError) {
    ack({ success: false, error: { code: error.code, message: error.message } });
    return;
  }

  console.error('[chat] unexpected socket handler error', error);
  ack({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

function validationError(message: string): AppError {
  return new AppError({ statusCode: 400, code: 'VALIDATION_ERROR', message });
}

// One room per conversation, joined only by sockets that passed
// `authorizeParticipant` — messages are broadcast here, never wider.
function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

// Registers the chat-specific event handlers on an already-authenticated,
// already-adapter-wired Socket.IO server (created by
// `infrastructure/socket/socketServer.ts`) — the module-owned half of the
// two-step composition `src/index.ts` already uses for the BullMQ workers.
export function registerChatGateway(io: ChatServer): void {
  io.on('connection', (socket) => {
    const userId = socket.data.user.id;

    // Authorization is re-checked here independently of `send_message`
    // (claude.md §7: "Chat participation is re-checked on every
    // send_message, not only on join") — joining grants no special trust,
    // it only puts this socket in the room for future broadcasts.
    socket.on('join_conversation', async (payload: unknown, ack?: Ack) => {
      const parsed = joinConversationSchema.safeParse(payload);

      if (!parsed.success) {
        ackError(ack, validationError(parsed.error.issues[0]?.message ?? 'Invalid payload.'));
        return;
      }

      try {
        await conversationService.authorizeParticipant(userId, parsed.data.conversationId);
        await socket.join(conversationRoom(parsed.data.conversationId));
        ack?.({ success: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    // A client can emit this without ever having joined (§47: "do not trust
    // conversation IDs from the client") — `conversationService.sendMessage`
    // re-authorizes independently of whatever `join_conversation` did or
    // didn't happen. The sender learns the outcome from this event's own
    // ack (carrying the persisted message); the room broadcast below is for
    // every OTHER socket that has joined, never a substitute for the ack.
    socket.on('send_message', async (payload: unknown, ack?: Ack<MessageDto>) => {
      const parsed = sendMessageSchema.safeParse(payload);

      if (!parsed.success) {
        ackError(ack, validationError(parsed.error.issues[0]?.message ?? 'Invalid payload.'));
        return;
      }

      try {
        const message = await conversationService.sendMessage(
          userId,
          parsed.data.conversationId,
          parsed.data.content,
        );
        io.to(conversationRoom(parsed.data.conversationId)).emit('message', message);
        ack?.({ success: true, data: message });
      } catch (error) {
        ackError(ack, error);
      }
    });
  });
}
