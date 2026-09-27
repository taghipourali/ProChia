/// <reference lib="webworker" />
/**
 * The demo's backend. This service worker answers `/api/*` for every page under the demo root
 * (member app, staff panel, landing page) by running the real API routes and services on PGlite, so
 * an order placed in one tab reaches the kitchen board in another over the same live stream.
 *
 * The database lives in memory and is saved to Cache Storage whenever it changes; a restarted
 * worker picks up from the last save.
 */
import './shims/globals';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../api/src/context';
import { payments } from '../../api/src/db/schema';
import { Scheduler } from '../../api/src/jobs/scheduler';
import { EventBus } from '../../api/src/lib/bus';
import { ConsoleSmsProvider } from '../../api/src/modules/notifications/providers';
import { FakeGateway } from '../../api/src/modules/payments/gateways';
import { createDemoApp, memoryJar } from './runtime/app';
import { demoConfig } from './runtime/config';
import { demoDb, PARSERS, shiftToNow } from './runtime/db';
import type { DemoServer } from './runtime/server';
import { UPLOADS_CACHE } from './shims/node-fs-promises';

declare const self: ServiceWorkerGlobalScope;
declare const __DEMO_VERSION__: string;

const ROOT = new URL(self.registration.scope);
const STATE_CACHE = `prochia-state-${__DEMO_VERSION__}`;
const ASSET_CACHE = `prochia-assets-${__DEMO_VERSION__}`;
const KEEP_ALIVE = `<script>setInterval(function(){navigator.serviceWorker.controller&&navigator.serviceWorker.controller.postMessage('ping')},20000)</script>`;

interface Backend {
  server: DemoServer;
  stop: () => Promise<void>;
}

let backend: Promise<Backend> | null = null;
const boot = () =>
  (backend ??= start().catch((err: unknown) => {
    backend = null;
    throw err;
  }));

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const keep = [STATE_CACHE, ASSET_CACHE, UPLOADS_CACHE];
      for (const key of await caches.keys()) {
        if (key.startsWith('prochia-') && !keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener('message', (event) => {
  // Every message (the pages ping every 20 s) keeps the worker, and the database, alive.
  if (event.data === 'claim') event.waitUntil(self.clients.claim());
  if (event.data === 'reset')
    event.waitUntil(reset().then(() => event.ports[0]?.postMessage('ok')));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const path = `/${url.pathname.slice(ROOT.pathname.length)}`;
  if (path.startsWith('/api/')) event.respondWith(api(event.request, path + url.search));
  else if (path.startsWith('/uploads/')) event.respondWith(upload(path));
});

async function api(request: Request, path: string) {
  try {
    const { server } = await boot();
    const res = await server.handle(request, path, {
      headers: {
        host: ROOT.host,
        // The API builds bank callback URLs from these; keep the demo's path prefix in them.
        'x-forwarded-host': ROOT.host + ROOT.pathname.replace(/\/$/, ''),
        'x-forwarded-proto': ROOT.protocol.replace(':', ''),
      },
    });
    return await adapt(res);
  } catch (err) {
    console.error(err);
    return Response.json(
      {
        error: {
          code: 'demo_unavailable',
          message: 'نسخهٔ نمایشی راه نیفتاد؛ صفحه را دوباره باز کنید',
        },
      },
      { status: 503 },
    );
  }
}

/** Redirects point at API paths or member-app routes; map both into the demo's layout. */
async function adapt(res: Response) {
  const location = res.headers.get('location');
  if (location?.startsWith('/')) {
    const target = location.startsWith('/api/')
      ? new URL(location.slice(1), ROOT)
      : new URL(`app/#${location}`, ROOT);
    return Response.redirect(target.href, 302);
  }
  if (res.headers.get('content-type')?.startsWith('text/html')) {
    const html = (await res.text()).replace('</body>', `${KEEP_ALIVE}</body>`);
    return new Response(html, { status: res.status, headers: res.headers });
  }
  return res;
}

async function upload(path: string) {
  const cache = await caches.open(UPLOADS_CACHE);
  return (
    (await cache.match(new URL(path, 'https://uploads.invalid'))) ??
    new Response(null, { status: 404 })
  );
}

/** Files next to the worker, kept in Cache Storage; `.gz` files are stored compressed. */
async function asset(name: string) {
  const cache = await caches.open(ASSET_CACHE);
  const url = new URL(name, ROOT);
  let res = await cache.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    await cache.put(url, res.clone());
  }
  if (!name.endsWith('.gz')) return res;
  return new Response(res.body!.pipeThrough(new DecompressionStream('gzip')));
}

async function start(): Promise<Backend> {
  const state = await caches.open(STATE_CACHE);
  const [wasm, fsBundle, saved, cookies] = await Promise.all([
    asset('pglite.wasm.gz')
      .then((r) => r.arrayBuffer())
      .then((bytes) => WebAssembly.compile(bytes)),
    asset('pglite.data.gz').then((r) => r.blob()),
    state.match('db').then((r) => r?.blob()),
    state.match('cookies').then((r) => r?.json() as Promise<Record<string, string>> | undefined),
  ]);
  const data = saved ?? (await (await asset('demo-data.tgz')).blob());

  const pg = await PGlite.create({
    loadDataDir: data,
    parsers: PARSERS,
    pgliteWasmModule: wasm,
    fsBundle,
  });
  const db = demoDb(pg);
  const lsn = async () =>
    (await pg.query<{ lsn: string }>('select pg_current_wal_insert_lsn()::text as lsn')).rows[0]!
      .lsn;
  let savedLsn = saved ? await lsn() : '';
  await shiftToNow(db);

  // A payment may have been started before the worker last stopped; its bank page still works.
  const gateway = new FakeGateway();
  const open = await db
    .select()
    .from(payments)
    .where(and(eq(payments.status, 'pending'), eq(payments.gateway, 'fake')));
  for (const p of open) {
    if (!p.authority || typeof p.meta?.returnBase !== 'string') continue;
    const callbackUrl = `${p.meta.returnBase}/api/v1/payments/${p.id}/callback`;
    gateway.remember(p.authority, { amount: p.amount, callbackUrl });
  }

  const ctx: AppContext = {
    config: demoConfig(),
    db,
    bus: new EventBus(),
    sms: new ConsoleSmsProvider(() => {}),
    gateway,
    now: () => new Date(),
  };
  const jar = memoryJar(cookies ?? {}, () => void state.put('cookies', Response.json(jar.all())));
  const server = createDemoApp(ctx, jar);
  const scheduler = new Scheduler(
    ctx,
    { acquire: async () => true, release: async () => {} },
    { error: (err, msg) => console.error(msg, err) },
  );
  scheduler.start();

  // Save whenever anything was written: requests, background jobs, the time shift above.
  let saving = false;
  const save = async () => {
    if (saving) return;
    saving = true;
    try {
      const now = await lsn();
      if (now === savedLsn) return;
      await pg.exec('checkpoint');
      const dump = await pg.dumpDataDir('none');
      await state.put('db', new Response(dump));
      savedLsn = now;
    } catch (err) {
      console.error('demo: saving the database failed', err);
    } finally {
      saving = false;
    }
  };
  const timer = setInterval(() => void save(), 2_000);

  return {
    server,
    stop: async () => {
      clearInterval(timer);
      await scheduler.stop();
      await pg.close();
    },
  };
}

async function reset() {
  const running = backend;
  backend = null;
  await running?.then((b) => b.stop()).catch(() => {});
  await caches.delete(STATE_CACHE);
  await caches.delete(UPLOADS_CACHE);
}
