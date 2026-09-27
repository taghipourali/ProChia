import type { AnalyticsEvent } from '@prochia/shared';
import { branchHeader } from './branch';
import { storage } from './storage';

/**
 * Lightweight product analytics (menu → item → cart → checkout → order), batched and sent to
 * our own API. No third-party trackers.
 */
type Props = Record<string, string | number | boolean | null>;
const queue: { name: AnalyticsEvent; props?: Props; at: string }[] = [];

const anonId = (() => {
  const existing = storage.get<string | null>('prochia.anon', null);
  if (existing) return existing;
  const id = crypto.randomUUID?.() ?? String(Math.random()).slice(2);
  storage.set('prochia.anon', id);
  return id;
})();

export function track(name: AnalyticsEvent, props?: Props) {
  queue.push({ name, props, at: new Date().toISOString() });
  if (queue.length >= 20) flush();
}

function flush() {
  if (!queue.length) return;
  const events = queue.splice(0, 50);
  void fetch('/api/v1/events', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'content-type': 'application/json', ...branchHeader() },
    body: JSON.stringify({ events, anonId }),
  }).catch(() => {});
}

window.setInterval(flush, 8000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
