import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tone = 'default' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Tone = 'default') => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    window.setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      tone === 'error' ? 5000 : 3200,
    );
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pc-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={t.tone === 'default' ? 'pc-toast' : `pc-toast pc-toast--${t.tone}`}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
