import { apiFetch } from './client';

// Verified against prisma/schema.prisma's enums.
export const SUPPORT_CONVERSATION_STATUSES = ['OPEN', 'RESOLVED', 'ESCALATED'] as const;
export type SupportConversationStatus = (typeof SUPPORT_CONVERSATION_STATUSES)[number];

export const SUPPORT_MESSAGE_ROLES = ['SYSTEM', 'USER', 'ASSISTANT', 'TOOL'] as const;
export type SupportMessageRole = (typeof SUPPORT_MESSAGE_ROLES)[number];

export interface SupportConversation {
  id: string;
  status: SupportConversationStatus;
  lastMessageAt: string;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  role: SupportMessageRole;
  status: 'COMPLETED' | 'FAILED';
  content: string | null;
  totalTokens: number | null;
  createdAt: string;
}

export interface SupportMessagePage {
  items: SupportMessage[];
  nextCursor: string | null;
}

export interface SupportConversationDetail extends SupportConversation {
  messages: SupportMessagePage;
}

// POST /api/v1/support/conversations — no body; a conversation starts
// empty, the first content arrives via a separate sendSupportMessage call.
export function createSupportConversation(
  accessToken?: string | null,
): Promise<SupportConversation> {
  return apiFetch('/support/conversations', { method: 'POST', accessToken });
}

export function listSupportConversations(
  params: { cursor?: string; limit?: number } = {},
  accessToken?: string | null,
): Promise<{ items: SupportConversation[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  return apiFetch(`/support/conversations${qs ? `?${qs}` : ''}`, { accessToken });
}

export function getSupportConversation(
  conversationId: string,
  params: { cursor?: string; limit?: number } = {},
  accessToken?: string | null,
): Promise<SupportConversationDetail> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  return apiFetch(`/support/conversations/${conversationId}${qs ? `?${qs}` : ''}`, { accessToken });
}

// POST /api/v1/support/conversations/:id/messages — returns BOTH the newly
// created user message and the assistant's reply, as a two-item array (the
// request is synchronous through the model). Rate-limited (10/min, 50/day)
// inside chatbotService itself.
export function sendSupportMessage(
  conversationId: string,
  content: string,
  accessToken?: string | null,
): Promise<{ messages: SupportMessage[] }> {
  return apiFetch(`/support/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content },
    accessToken,
  });
}
