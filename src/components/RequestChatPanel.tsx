import { useEffect, useRef, useState } from 'react';
import { Send, WifiOff } from 'lucide-react';
import { apiFetch, type ChatMessageItem } from '../types/api.ts';

interface RequestChatPanelProps {
  requestId: number;
  requestCode: string;
  currentUserId: number;
  token: string;
  isOffline: boolean;
  canSend: boolean;
  incomingMessages: ChatMessageItem[];
}

interface QueuedMessage {
  clientMsgId: string;
  body: string;
}

export function RequestChatPanel({
  requestId,
  requestCode,
  currentUserId,
  token,
  isOffline,
  canSend,
  incomingMessages,
}: RequestChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<QueuedMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<{ messages: ChatMessageItem[] }>(`/api/requests/${requestId}/messages`, { token })
      .then((res) => {
        if (active) {
          setMessages(res.messages);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load messages.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [requestId, token]);

  // Merge incoming Socket.IO messages idempotently
  useEffect(() => {
    const relevant = incomingMessages.filter((m) => m.requestId === requestId);
    if (relevant.length === 0) return;
    setMessages((prev) => {
      const next = [...prev];
      for (const msg of relevant) {
        const exists = next.some(
          (item) =>
            item.id === msg.id ||
            (msg.clientMsgId && item.clientMsgId === msg.clientMsgId),
        );
        if (!exists) {
          next.push(msg);
        }
      }
      return next;
    });
  }, [incomingMessages, requestId]);

  // Auto-flush queued offline messages upon reconnection
  useEffect(() => {
    if (isOffline || offlineQueue.length === 0) return;
    let cancelled = false;
    const flush = async () => {
      const remaining: QueuedMessage[] = [];
      for (const item of offlineQueue) {
        if (cancelled) return;
        try {
          const res = await apiFetch<{ message: ChatMessageItem }>(
            `/api/requests/${requestId}/messages`,
            {
              method: 'POST',
              token,
              body: item,
            },
          );
          setMessages((prev) =>
            prev.some((m) => m.id === res.message.id || m.clientMsgId === item.clientMsgId)
              ? prev
              : [...prev, res.message],
          );
        } catch {
          remaining.push(item);
        }
      }
      if (!cancelled) {
        setOfflineQueue(remaining);
      }
    };
    void flush();
    return () => {
      cancelled = true;
    };
  }, [isOffline, offlineQueue, requestId, token]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, offlineQueue.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !canSend) return;

    const clientMsgId = `msg-${currentUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setDraft('');
    setError(null);

    if (isOffline) {
      setOfflineQueue((prev) => [...prev, { clientMsgId, body: trimmed }]);
      return;
    }

    setSending(true);
    try {
      const res = await apiFetch<{ message: ChatMessageItem }>(
        `/api/requests/${requestId}/messages`,
        {
          method: 'POST',
          token,
          body: { body: trimmed, clientMsgId },
        },
      );
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id || m.clientMsgId === clientMsgId)
          ? prev
          : [...prev, res.message],
      );
    } catch (err) {
      setOfflineQueue((prev) => [...prev, { clientMsgId, body: trimmed }]);
      setError(
        err instanceof Error
          ? `${err.message} Queued for automatic resend on reconnect.`
          : 'Connection lost; message queued.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl flex flex-col h-[380px]">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Visit Messaging · {requestCode}
          </h3>
          <p className="text-xs text-slate-500">
            Direct encrypted channel between patient and assigned nurse
          </p>
        </div>
        {offlineQueue.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
            <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
            {offlineQueue.length} queued
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/60">
        {loading ? (
          <p className="text-xs text-slate-500">Loading visit messages...</p>
        ) : messages.length === 0 && offlineQueue.length === 0 ? (
          <p className="text-xs text-slate-500">
            No messages yet. Use this channel to coordinate gate entry, floor access, or arrival timing.
          </p>
        ) : (
          <>
            {messages.map((msg) => {
              const mine = msg.senderId === currentUserId;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col max-w-[82%] ${mine ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                >
                  <span className="text-[11px] text-slate-500 mb-1">
                    {msg.senderName} · {msg.senderRole === 'nurse' ? 'Nurse' : 'Patient'} ·{' '}
                    <span className="font-mono tabular-nums">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                  <div
                    className={`px-3.5 py-2 rounded-xl text-sm leading-relaxed ${
                      mine
                        ? 'bg-teal-700 text-white'
                        : 'bg-white border border-slate-200 text-slate-900'
                    }`}
                  >
                    {msg.body}
                  </div>
                </div>
              );
            })}
            {offlineQueue.map((q) => (
              <div key={q.clientMsgId} className="flex flex-col max-w-[82%] ml-auto items-end opacity-75">
                <span className="text-[11px] text-amber-700 mb-1">Queued offline · waiting to reconnect</span>
                <div className="px-3.5 py-2 rounded-xl text-sm bg-teal-600 text-white">{q.body}</div>
              </div>
            ))}
          </>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
          {error}
        </div>
      )}

      <form onSubmit={handleSend} className="p-3 border-t border-slate-200 flex items-center gap-2">
        <label htmlFor={`chat-input-${requestId}`} className="sr-only">
          Send message to assigned visit participant
        </label>
        <input
          id={`chat-input-${requestId}`}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canSend || sending}
          placeholder={
            canSend
              ? 'Type a coordination message...'
              : 'Messaging is closed after visit completion or cancellation.'
          }
          className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend || sending || !draft.trim()}
          aria-label="Send message"
          className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
          <span>Send</span>
        </button>
      </form>
    </section>
  );
}
