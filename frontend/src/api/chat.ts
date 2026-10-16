import { io, type Socket } from 'socket.io-client';
import { apiFetch } from './client';
import { SOCKET_BASE_URL } from './config';

// Verified against src/modules/chat/services/conversationService.ts's DTOs.
export interface ChatCounterpart {
  id: string;
  name: string;
}

export interface ChatMessagePreview {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  rideId: string;
  counterpart: ChatCounterpart;
  lastMessage: ChatMessagePreview | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: string | null;
  createdAt: string;
}

export interface ChatConversationPage {
  items: ChatConversation[];
  nextCursor: string | null;
}

export interface ChatMessagePage {
  items: ChatMessage[];
  nextCursor: string | null;
}

// GET /api/v1/conversations — REST covers history only; sending is
// WebSocket-only (no REST POST-message endpoint exists for this module).
export function listConversations(
  params: { cursor?: string; limit?: number } = {},
  accessToken?: string | null,
): Promise<ChatConversationPage> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  return apiFetch(`/conversations${qs ? `?${qs}` : ''}`, { accessToken });
}

export function listMessages(
  conversationId: string,
  params: { cursor?: string; limit?: number } = {},
  accessToken?: string | null,
): Promise<ChatMessagePage> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  return apiFetch(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`, {
    accessToken,
  });
}

type AckResponse<T> =
  | { success: true; data?: T }
  | { success: false; error: { code: string; message: string } };

// One socket per mounted chat screen — the handshake carries the same
// access token HTTP does (src/infrastructure/socket/socketServer.ts reads
// `socket.handshake.auth.token`).
export function connectChatSocket(accessToken: string): Socket {
  return io(SOCKET_BASE_URL, {
    auth: { token: accessToken },
    // The default path already matches the server (`/socket.io/`); explicit
    // here only so a future proxy rewrite can't silently diverge.
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
  });
}

export function joinConversation(socket: Socket, conversationId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit('join_conversation', { conversationId }, (response: AckResponse<undefined>) => {
      if (response.success) {
        resolve();
      } else {
        reject(new Error(response.error.message));
      }
    });
  });
}

export function sendChatMessage(
  socket: Socket,
  conversationId: string,
  content: string,
): Promise<ChatMessage> {
  return new Promise((resolve, reject) => {
    socket.emit(
      'send_message',
      { conversationId, content },
      (response: AckResponse<ChatMessage>) => {
        if (response.success && response.data) {
          resolve(response.data);
        } else if (!response.success) {
          reject(new Error(response.error.message));
        } else {
          reject(new Error('No message returned.'));
        }
      },
    );
  });
}
