import { Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  createSupportConversation,
  getSupportConversation,
  listSupportConversations,
  sendSupportMessage,
  type SupportMessage,
} from '@/api/support';
import { withAuthRetry } from '@/api/withAuthRetry';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

const MAX_MESSAGE_LENGTH = 2000;

export function SupportScreen() {
  const session = useSession();
  const { toast } = useToast();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Reuse the most recently active conversation if one exists, so
        // returning to this screen continues the same thread instead of
        // starting a fresh, empty one every visit.
        const existing = await withAuthRetry(session, (token) =>
          listSupportConversations({ limit: 1 }, token),
        );
        const first = existing.items[0];

        if (first) {
          const detail = await withAuthRetry(session, (token) =>
            getSupportConversation(first.id, {}, token),
          );
          if (cancelled) return;
          setConversationId(detail.id);
          setMessages([...detail.messages.items].reverse().filter((m) => m.role !== 'SYSTEM'));
        } else {
          const created = await withAuthRetry(session, (token) =>
            createSupportConversation(token),
          );
          if (cancelled) return;
          setConversationId(created.id);
          setMessages([]);
        }
      } catch (cause) {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : 'Could not start Saathi AI.');
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function handleSend() {
    const content = draft.trim();
    if (content.length === 0 || conversationId === null || sending) return;

    setSending(true);
    setDraft('');
    try {
      const { messages: newMessages } = await withAuthRetry(session, (token) =>
        sendSupportMessage(conversationId, content, token),
      );
      setMessages((current) => [...(current ?? []), ...newMessages]);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Saathi AI could not reply. Try again.', 'error');
      // Give the draft back so a rate-limit or network failure doesn't lose it.
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex min-h-[28rem] flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle p-4">
        <Sparkles className="size-5 text-accent-700" aria-hidden />
        <div>
          <h1 className="text-sm font-semibold text-ink">Saathi AI</h1>
          <p className="text-xs text-ink-muted">Ask about bookings, payments or how Ryderex works.</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages === null && loadError === null && (
          <p className="text-sm text-ink-muted">Starting…</p>
        )}
        {loadError !== null && <p className="text-sm text-red-600">{loadError}</p>}
        {messages !== null && messages.length === 0 && (
          <p className="text-sm text-ink-muted">
            Ask anything about your rides, bookings or payments.
          </p>
        )}
        {messages?.map((message) => {
          const mine = message.role === 'USER';
          return (
            <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                  mine ? 'bg-accent-700 text-white' : 'bg-slate-100 text-ink',
                  message.status === 'FAILED' && 'border border-red-300 bg-red-50 text-red-700',
                )}
              >
                {message.content ?? (message.status === 'FAILED' ? "Couldn't generate a reply." : '…')}
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
            setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH));
          }}
          placeholder="Ask Saathi AI…"
          disabled={conversationId === null}
          className="h-10 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent-700 focus:outline-none disabled:bg-slate-50"
        />
        <Button
          type="submit"
          loading={sending}
          disabled={draft.trim().length === 0 || conversationId === null}
        >
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </Card>
  );
}
