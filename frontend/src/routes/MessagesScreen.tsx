import { Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';

import {
  connectChatSocket,
  joinConversation,
  listConversations,
  listMessages,
  sendChatMessage,
  type ChatConversation,
  type ChatMessage,
} from '@/api/chat';
import { withAuthRetry } from '@/api/withAuthRetry';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function MessagesScreen() {
  const session = useSession();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { id: routeConversationId } = useParams<{ id: string }>();

  const [conversations, setConversations] = useState<ChatConversation[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const joinedConversationRef = useRef<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);

  // Load the conversation list once.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const page = await withAuthRetry(session, (token) => listConversations({}, token));
        if (cancelled) return;
        setConversations(page.items);
        // Desktop convenience: land on the most recent conversation if none
        // is selected via the URL yet. Mobile users still see the list
        // first because the panes stack and the thread pane is hidden until
        // a conversation is actually chosen.
        if (routeConversationId === undefined && page.items.length > 0 && page.items[0]) {
          navigate(`/messages/${page.items[0].id}`, { replace: true });
        }
      } catch (cause) {
        if (cancelled) return;
        setConversationsError(
          cause instanceof Error ? cause.message : 'Could not load your conversations.',
        );
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One socket for the lifetime of this screen.
  useEffect(() => {
    if (!session.accessToken) return;
    const socket = connectChatSocket(session.accessToken);
    socketRef.current = socket;

    socket.on('message', (incoming: ChatMessage) => {
      setMessages((current) => {
        if (current === null || incoming.conversationId !== routeConversationIdRef.current) {
          return current;
        }
        return [...current, incoming];
      });
      setConversations((current) =>
        current === null
          ? current
          : current.map((conversation) =>
              conversation.id === incoming.conversationId
                ? {
                    ...conversation,
                    lastMessage: {
                      id: incoming.id,
                      senderId: incoming.senderId,
                      content: incoming.content,
                      createdAt: incoming.createdAt,
                    },
                  }
                : conversation,
            ),
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.accessToken]);

  // Kept in a ref so the 'message' listener above (registered once) always
  // reads the CURRENTLY selected conversation without re-subscribing.
  const routeConversationIdRef = useRef(routeConversationId);
  routeConversationIdRef.current = routeConversationId;

  // Load history and join the room whenever the selected conversation changes.
  useEffect(() => {
    if (routeConversationId === undefined) {
      setMessages(null);
      return;
    }

    let cancelled = false;
    setMessages(null);
    setMessagesError(null);

    async function load() {
      try {
        const page = await withAuthRetry(session, (token) =>
          listMessages(routeConversationId!, {}, token),
        );
        if (cancelled) return;
        // Oldest-first for display; the API returns newest-first pages.
        setMessages([...page.items].reverse());
      } catch (cause) {
        if (cancelled) return;
        setMessagesError(cause instanceof Error ? cause.message : 'Could not load messages.');
      }
    }

    void load();

    const socket = socketRef.current;
    if (socket && joinedConversationRef.current !== routeConversationId) {
      joinConversation(socket, routeConversationId)
        .then(() => {
          joinedConversationRef.current = routeConversationId;
        })
        .catch(() => {
          // A failed join still leaves REST history visible; sending will
          // surface its own error if the room was never joined.
        });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConversationId]);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (content.length === 0 || routeConversationId === undefined || sending) return;

    const socket = socketRef.current;
    if (!socket) {
      toast('Not connected. Try again in a moment.', 'error');
      return;
    }

    setSending(true);
    try {
      const message = await sendChatMessage(socket, routeConversationId, content);
      setMessages((current) => (current === null ? [message] : [...current, message]));
      setConversations((current) =>
        current === null
          ? current
          : current.map((conversation) =>
              conversation.id === routeConversationId
                ? {
                    ...conversation,
                    lastMessage: {
                      id: message.id,
                      senderId: message.senderId,
                      content: message.content,
                      createdAt: message.createdAt,
                    },
                  }
                : conversation,
            ),
      );
      setDraft('');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not send that message.', 'error');
    } finally {
      setSending(false);
    }
  }, [draft, routeConversationId, sending, toast]);

  const activeConversation = conversations?.find((c) => c.id === routeConversationId) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr] md:gap-6">
      {/* Conversation list — hidden on mobile once a thread is open. */}
      <Card className={cn('flex flex-col overflow-hidden', routeConversationId && 'hidden md:flex')}>
        <div className="border-b border-border-subtle p-4">
          <h1 className="text-lg font-semibold text-ink">Messages</h1>
        </div>
        {conversations === null && conversationsError === null && (
          <div className="p-4">
            <ListSkeleton rows={4} />
          </div>
        )}
        {conversationsError !== null && (
          <p className="p-4 text-sm text-red-600">{conversationsError}</p>
        )}
        {conversations !== null && conversations.length === 0 && (
          <p className="p-4 text-sm text-ink-muted">
            No conversations yet. Booking or publishing a ride opens a thread with the other side
            automatically.
          </p>
        )}
        <div className="flex-1 overflow-y-auto">
          {conversations?.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => {
                navigate(`/messages/${conversation.id}`);
              }}
              className={cn(
                'block w-full border-b border-border-subtle px-4 py-3 text-left transition-colors hover:bg-slate-50',
                conversation.id === routeConversationId && 'bg-accent-50',
              )}
            >
              <p className="truncate text-sm font-medium text-ink">
                {conversation.counterpart.name}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {conversation.lastMessage?.content ?? 'No messages yet'}
              </p>
            </button>
          ))}
        </div>
      </Card>

      {/* Thread — hidden on mobile until a conversation is selected. */}
      <Card className={cn('flex min-h-[28rem] flex-col', !routeConversationId && 'hidden md:flex')}>
        {routeConversationId === undefined ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
            Select a conversation to see the messages.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border-subtle p-4">
              <button
                type="button"
                onClick={() => {
                  navigate('/messages');
                }}
                className="rounded-md p-1 text-ink-muted hover:bg-slate-100 md:hidden"
                aria-label="Back to conversations"
              >
                ←
              </button>
              <h2 className="text-sm font-semibold text-ink">
                {activeConversation?.counterpart.name ?? 'Conversation'}
              </h2>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages === null && messagesError === null && <ListSkeleton rows={3} />}
              {messagesError !== null && <p className="text-sm text-red-600">{messagesError}</p>}
              {messages?.map((message) => {
                const mine = message.senderId === session.user?.id;
                return (
                  <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[75%] rounded-lg px-3 py-2 text-sm',
                        mine ? 'bg-accent-700 text-white' : 'bg-slate-100 text-ink',
                      )}
                    >
                      <p>{message.content}</p>
                      <p className={cn('mt-1 text-[10px]', mine ? 'text-accent-100' : 'text-ink-faint')}>
                        {formatTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={scrollBottomRef} />
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSend();
              }}
              className="flex items-center gap-2 border-t border-border-subtle p-3"
            >
              <input
                type="text"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                placeholder="Message…"
                className="h-10 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent-700 focus:outline-none"
              />
              <Button type="submit" size="md" loading={sending} disabled={draft.trim().length === 0}>
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
