import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { s } from './helpers';
import {
  createFixture,
  createTestContext,
  resetDatabase,
  type Fixture,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  await resetDatabase();
  ctx = createTestContext();
  fx = await createFixture(ctx, { memberApproval: 'whitelist' });
  app = await buildApp(ctx);
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

const host = { host: 'gym.prochia.local' };

async function login(phone: string) {
  const otp = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp',
    headers: host,
    payload: { phone },
  });
  expect(otp.statusCode).toBe(200);
  const { devCode } = otp.json() as { devCode: string };
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify',
    headers: host,
    payload: { phone, code: devCode },
  });
  expect(verify.statusCode).toBe(200);
  const cookie = verify.cookies.find((c) => c.name === 'pc_session')!;
  return {
    cookie: `pc_session=${cookie.value}`,
    body: verify.json() as { membershipStatus: string },
  };
}

describe('member HTTP flow', () => {
  it('resolves the gym from the subdomain', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/branch', headers: host });
    expect(res.json()).toMatchObject({ slug: 'gym', gymName: 'باشگاه تست' });
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/branch',
      headers: { 'x-branch': 'nope' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('logs in with an SMS code; unlisted numbers wait for approval', async () => {
    const { cookie, body } = await login('۰۹۱۲۳۴۵۶۷۸۹');
    expect(body.membershipStatus).toBe('pending');
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/quote',
      headers: { ...host, cookie },
      payload: { lines: [{ itemId: fx.items.bowl, quantity: 1 }] },
    });
    expect(quote.statusCode).toBe(403);
    expect(quote.json().error.code).toBe('membership_pending');
  });

  it('rejects a wrong code and rate-limits resends', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp',
      headers: host,
      payload: { phone: '09355555555' },
    });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp',
      headers: host,
      payload: { phone: '09355555555' },
    });
    expect(again.statusCode).toBe(429);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: host,
      payload: { phone: '09355555555', code: '00000' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toBe('کد واردشده درست نیست');
  });

  it('whitelisted members order, and the restaurant sees and accepts it', async () => {
    await ctx.db.insert(s.memberWhitelist).values({ branchId: fx.branch.id, phone: '09121112233' });
    const { cookie, body } = await login('09121112233');
    expect(body.membershipStatus).toBe('active');

    const profile = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/health',
      headers: { ...host, cookie },
      payload: {
        sex: 'male',
        birthDate: '1998-04-10',
        heightCm: 180,
        weightKg: 84,
        bodyFatPct: null,
        activity: 'high',
        goal: 'cut',
        trainingTime: 'evening',
        trainingDaysPerWeek: 5,
        mealsPerDay: 4,
        allergens: [],
        dietPreferences: [],
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ bmiBand: 'over', targets: { protein: 185 } });

    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { ...host, cookie },
      payload: {
        lines: [{ itemId: fx.items.bowl, quantity: 1 }],
        type: 'pickup',
        paymentMethod: 'counter',
      },
    });
    expect(order.statusCode).toBe(200);
    const { orderId, number } = order.json() as { orderId: string; number: number };
    expect(number).toBe(1);

    const staffLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: { username: 'kitchen', password: 'password123' },
    });
    const { token } = staffLogin.json() as { token: string };
    const auth = { authorization: `Bearer ${token}` };

    const board = await app.inject({ method: 'GET', url: '/api/v1/staff/board', headers: auth });
    expect((board.json() as { id: string }[]).map((o) => o.id)).toContain(orderId);

    // Kitchen staff may not see analytics or edit the menu.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/staff/analytics', headers: auth }))
        .statusCode,
    ).toBe(403);

    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/orders/${orderId}/accept`,
      headers: auth,
      payload: {},
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().order.status).toBe('accepted');

    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}`,
      headers: { ...host, cookie },
    });
    expect(mine.json()).toMatchObject({ status: 'accepted', number: 1 });
  });

  it('keeps members out of staff endpoints', async () => {
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 2 * 60_000);
    const { cookie } = await login('09121112233');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/board',
      headers: { ...host, cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets managers read analytics', async () => {
    const staffLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: { username: 'manager', password: 'password123' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/analytics',
      headers: { authorization: `Bearer ${staffLogin.json().token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kpi).toHaveProperty('revenue');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: { username: 'manager', password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('approves waiting sign-ups when reception imports the gym member list', async () => {
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 5 * 60_000);
    const { body } = await login('09357778899');
    expect(body.membershipStatus).toBe('pending');

    const staffLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: { username: 'cashier', password: 'password123' },
    });
    const auth = { authorization: `Bearer ${staffLogin.json().token}` };
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/whitelist',
      headers: auth,
      payload: { entries: [{ phone: '۰۹۳۵۷۷۷۸۸۹۹', gymMemberCode: 'G-77' }] },
    });
    expect(imported.statusCode).toBe(200);

    const members = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/members?q=09357778899',
      headers: auth,
    });
    expect(members.json()[0]).toMatchObject({ status: 'active', gymMemberCode: 'G-77' });

    // Cashiers may approve members but not grant VIP credit.
    const vip = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/members/${members.json()[0].id}`,
      headers: auth,
      payload: { isVip: true, creditLimit: 1_000_000 },
    });
    expect(vip.statusCode).toBe(403);
  });
});
