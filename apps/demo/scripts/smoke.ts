/**
 * Runs the demo's in-browser server in Node on the built demo data, two days after it was built:
 * the history moves to "now", a new member signs in and pays through the fake bank, the kitchen
 * accepts and both stations finish, the cashier hands it over, and the member's live stream reports
 * each step. Run `pnpm --filter @prochia/demo test`.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { AppContext } from '../../api/src/context';
import { EventBus } from '../../api/src/lib/bus';
import { ConsoleSmsProvider } from '../../api/src/modules/notifications/providers';
import { FakeGateway } from '../../api/src/modules/payments/gateways';
import { createDemoApp, memoryJar } from '../src/runtime/app';
import { demoConfig } from '../src/runtime/config';
import { demoDb, PARSERS, shiftToNow } from '../src/runtime/db';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(here, '../.data/demo-data.tgz');
assert.ok(existsSync(dataFile), 'run `pnpm --filter @prochia/demo data` first');

const later = () => new Date(Date.now() + 2 * 86_400_000);
const pg = await PGlite.create({
  loadDataDir: new Blob([await readFile(dataFile)]),
  parsers: PARSERS,
});
const db = demoDb(pg);
const shifted = await shiftToNow(db, later());
assert.ok(shifted > 47 * 3_600_000, 'history moves forward to the time the demo is opened');

const ctx: AppContext = {
  config: demoConfig(),
  db,
  bus: new EventBus(),
  sms: new ConsoleSmsProvider(() => {}),
  gateway: new FakeGateway(),
  now: later,
};
const jar = memoryJar();
const server = createDemoApp(ctx, jar);
// What the service worker adds for a demo served from https://example.github.io/prochia/.
const info = {
  headers: { host: 'example.github.io', 'x-forwarded-host': 'example.github.io/prochia' },
};
const local = (url: string) => {
  const u = new URL(url.replaceAll('&amp;', '&'));
  return u.pathname.replace(/^\/prochia/, '') + u.search;
};

let staffToken = '';
async function send(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (url.startsWith('/api/v1/staff/') && staffToken)
    headers.authorization = `Bearer ${staffToken}`;
  const req = new Request(`http://demo.invalid${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return server.handle(req, url, info);
}
async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await send(method, url, body);
  const text = await res.text();
  assert.ok(res.ok, `${method} ${url} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
const staffLogin = async (username: string) => {
  staffToken = (
    await call<{ token: string }>('POST', '/api/v1/staff/auth/login', {
      username,
      password: 'prochia1234',
    })
  ).token;
};

// Member signs in with a new number (the demo skips the whitelist) and fills in a name.
const phone = '09351234567';
const otp = await call<{ devCode: string }>('POST', '/api/v1/auth/otp', { phone });
const verified = await call<{ membershipStatus: string }>('POST', '/api/v1/auth/verify', {
  phone,
  code: otp.devCode,
});
assert.equal(verified.membershipStatus, 'active');
assert.ok(jar.all().pc_session, 'the session cookie lands in the jar');
await call('PUT', '/api/v1/me/profile', {
  firstName: 'مهمان',
  lastName: 'دمو',
  birthDate: null,
  sex: null,
});

// A meal and a coffee, paid through the fake bank.
type MenuItem = { id: string; name: string; available: boolean; groups: unknown[] };
const menu = await call<{ categories: { items: MenuItem[] }[] }>('GET', '/api/v1/menu');
const items = menu.categories.flatMap((c) => c.items).filter((i) => i.available);
const meal = items.find((i) => i.name === 'بول مرغ گریل')!;
const coffee = items.find((i) => i.name === 'آمریکانو')!;
assert.ok(meal && coffee, 'seeded items are on the menu');
const order = await call<{ orderId: string; redirectUrl: string }>('POST', '/api/v1/orders', {
  lines: [
    { itemId: meal.id, quantity: 1, optionIds: [] },
    { itemId: coffee.id, quantity: 1, optionIds: [] },
  ],
  type: 'pickup',
  paymentMethod: 'gateway',
  useCredits: false,
});
assert.match(order.redirectUrl, /^https:\/\/example\.github\.io\/prochia\/api\/v1\/payments\//);

const bank = await send('GET', local(order.redirectUrl));
const pay = /href="([^"]+Status=OK)"/.exec(await bank.text())?.[1];
assert.ok(pay, 'the bank page offers a successful payment');
const back = await send('GET', local(pay));
assert.equal(back.status, 302);
assert.equal(back.headers.get('location'), `/orders/${order.orderId}?payment=ok`);

// The member watches the order live while the staff work on it.
const stream = await send('GET', `/api/v1/orders/${order.orderId}/stream`);
const reader = stream.body!.getReader();
const statuses: string[] = [];
const reading = (async () => {
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const m of decoder
      .decode(value)
      .matchAll(/event: order\.updated\ndata: .*?"status":"(\w+)"/g))
      statuses.push(m[1]!);
  }
})();

await staffLogin('kitchen');
await call('POST', `/api/v1/staff/orders/${order.orderId}/accept`, {});
const detail = await call<{ tickets: { id: string; stationName: string }[] }>(
  'GET',
  `/api/v1/staff/orders/${order.orderId}`,
);
assert.equal(detail.tickets.length, 2, 'one ticket each for the restaurant and the café');
for (const t of detail.tickets) {
  await call('POST', `/api/v1/staff/tickets/${t.id}`, { action: 'start' });
  await call('POST', `/api/v1/staff/tickets/${t.id}`, { action: 'ready' });
}
await staffLogin('cashier');
await call('POST', `/api/v1/staff/orders/${order.orderId}/handover`, {});

await new Promise((r) => setTimeout(r, 20));
await reader.cancel();
await reading;
assert.deepEqual([...new Set(statuses)], ['accepted', 'preparing', 'ready', 'completed']);

const mine = await call<{ status: string }>('GET', `/api/v1/orders/${order.orderId}`);
assert.equal(mine.status, 'completed');

// Unknown routes and bad input answer like the real API.
assert.equal((await send('GET', '/api/v1/nope')).status, 404);
const invalid = await send('POST', '/api/v1/auth/otp', { phone: '123' });
assert.equal(invalid.status, 400);

await pg.close();
console.log('demo smoke test passed');
