import { useEffect, useRef, useState } from 'react';
import { authHeaders } from './api';
import { apiUrl } from './session';

export interface StreamEvent {
  type: string;
  orderId?: string;
  status?: string;
  number?: number;
  stationId?: string;
  ingredientIds?: string[];
}

/**
 * The branch's live event stream. Uses fetch rather than EventSource so the bearer token travels
 * in a header, and reconnects with backoff when the network drops (kitchen Wi-Fi does).
 */
export function useStaffStream(onEvent: (event: StreamEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let attempt = 0;

    const connect = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(apiUrl('/staff/stream'), {
            headers: authHeaders(),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          setConnected(true);
          attempt = 0;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let split: number;
            while ((split = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, split);
              buffer = buffer.slice(split + 2);
              const data = chunk
                .split('\n')
                .filter((l) => l.startsWith('data: '))
                .map((l) => l.slice(6))
                .join('\n');
              if (data) {
                try {
                  handler.current(JSON.parse(data) as StreamEvent);
                } catch {
                  /* ignore malformed event */
                }
              }
            }
          }
        } catch {
          /* fall through to reconnect */
        }
        setConnected(false);
        if (stopped) return;
        attempt++;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15_000)));
      }
    };
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }, [enabled]);

  return connected;
}
