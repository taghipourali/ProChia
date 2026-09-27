/**
 * Page side of the static demo. The member app, the staff panel and the landing page call
 * `startDemo()` before rendering: it installs the service worker that serves `/api` in the browser,
 * waits until the worker controls the page and the database has booted, and keeps the worker awake
 * while the page is open.
 */

/** The demo root, one level above `app/` and `panel/`. */
export function demoRoot(from: string = location.href) {
  return new URL('..', from);
}

/** Path prefix for API and upload URLs in the demo, e.g. `/prochia`. */
export function demoApiBase(root: URL = demoRoot()) {
  return root.pathname.replace(/\/$/, '');
}

export async function startDemo(root: URL = demoRoot()): Promise<void> {
  const splash = showSplash();
  try {
    if (!('serviceWorker' in navigator)) throw new Error('unsupported');
    const registration = await navigator.serviceWorker.register(new URL('sw.js', root), {
      scope: root.pathname,
    });
    if (!navigator.serviceWorker.controller) {
      const controlled = new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
      // A hard reload bypasses an already active worker until it claims the page again.
      (await navigator.serviceWorker.ready).active?.postMessage('claim');
      await controlled;
    }
    void registration.update().catch(() => {});
    window.setInterval(() => navigator.serviceWorker.controller?.postMessage('ping'), 20_000);

    const health = await fetch(new URL('api/health', root));
    if (!health.ok) throw new Error(`health ${health.status}`);
    splash.remove();
  } catch (err) {
    splash.fail(
      'serviceWorker' in navigator
        ? 'نسخهٔ نمایشی در این مرورگر راه نیفتاد. صفحه را دوباره باز کنید.'
        : 'این مرورگر (یا حالت ناشناس) از نسخهٔ نمایشی پشتیبانی نمی‌کند. با کروم، اج، فایرفاکس یا سافاری معمولی باز کنید.',
    );
    throw err;
  }
}

/** Wipes the demo's database and uploads back to the seeded state. */
export async function resetDemo() {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return;
  const channel = new MessageChannel();
  const done = new Promise((resolve) => (channel.port1.onmessage = resolve));
  worker.postMessage('reset', [channel.port2]);
  await done;
}

function showSplash() {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#f7f7f2;color:#101913;font:15px/1.8 system-ui,sans-serif;direction:rtl;text-align:center;padding:24px';
  el.innerHTML = `<div style="max-width:320px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-.01em">پروچیا</div>
    <div data-text style="color:#4a574f;margin-top:4px">در حال آماده‌سازی نسخهٔ نمایشی…</div>
    <div data-bar style="height:3px;background:#dfe3da;margin-top:16px;overflow:hidden"><div style="height:100%;width:30%;background:#17603a;animation:pc-demo-boot 1.1s ease-in-out infinite alternate"></div></div>
    <style>@keyframes pc-demo-boot{from{margin-inline-start:0}to{margin-inline-start:70%}}</style>
  </div>`;
  // Fast boots (worker already running) should not flash the splash.
  const timer = window.setTimeout(() => document.body.append(el), 250);
  return {
    remove: () => {
      window.clearTimeout(timer);
      el.remove();
    },
    fail: (message: string) => {
      window.clearTimeout(timer);
      el.querySelector('[data-text]')!.textContent = message;
      el.querySelector('[data-bar]')?.remove();
      document.body.append(el);
    },
  };
}
