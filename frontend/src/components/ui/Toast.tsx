import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-emerald-700' },
  error: { icon: AlertCircle, className: 'text-red-700' },
  info: { icon: Info, className: 'text-accent-700' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      timers.current.set(
        id,
        window.setTimeout(() => {
          dismiss(id);
        }, AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  // Clearing on unmount keeps a timer from firing setState after the
  // provider is gone (StrictMode double-mounts this in development).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => {
        window.clearTimeout(timer);
      });
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => {
          const { icon: Icon, className } = TONE_STYLES[item.tone];
          return (
            <div
              key={item.id}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-lg"
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
              <p className="flex-1 text-sm text-ink">{item.message}</p>
              <button
                type="button"
                onClick={() => {
                  dismiss(item.id);
                }}
                aria-label="Dismiss"
                className="-m-1 rounded p-1 text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return context;
}
