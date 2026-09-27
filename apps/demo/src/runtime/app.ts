import type { AppContext } from '../../../api/src/context';
import { authRoutes } from '../../../api/src/routes/auth';
import { memberRoutes } from '../../../api/src/routes/member';
import { paymentRoutes } from '../../../api/src/routes/payments';
import { publicRoutes } from '../../../api/src/routes/public';
import { staffAdminRoutes } from '../../../api/src/routes/staff/admin';
import { staffClubRoutes } from '../../../api/src/routes/staff/club';
import { staffInventoryRoutes } from '../../../api/src/routes/staff/inventory';
import { staffMemberRoutes } from '../../../api/src/routes/staff/members';
import { staffMenuRoutes } from '../../../api/src/routes/staff/menu';
import { staffOrderRoutes } from '../../../api/src/routes/staff/orders';
import { DemoServer, type CookieJar } from './server';

/** The API's routes, as registered by `buildApp`, on the in-browser server. */
export function createDemoApp(ctx: AppContext, jar: CookieJar) {
  const server = new DemoServer(jar);
  const app = server.asFastify();
  server.get('/api/health', () => ({ ok: true }));
  publicRoutes(app, ctx);
  authRoutes(app, ctx);
  memberRoutes(app, ctx);
  paymentRoutes(app, ctx);
  staffOrderRoutes(app, ctx);
  staffMenuRoutes(app, ctx);
  staffInventoryRoutes(app, ctx);
  staffMemberRoutes(app, ctx);
  staffClubRoutes(app, ctx);
  staffAdminRoutes(app, ctx);
  return server;
}

/** A cookie jar kept in memory; the service worker persists it between restarts. */
export function memoryJar(initial: Record<string, string> = {}, onChange?: () => void): CookieJar {
  const cookies = new Map(Object.entries(initial));
  return {
    all: () => Object.fromEntries(cookies),
    set(name, value, expires) {
      if (expires && expires.getTime() <= Date.now()) cookies.delete(name);
      else cookies.set(name, value);
      onChange?.();
    },
    delete(name) {
      cookies.delete(name);
      onChange?.();
    },
  };
}
