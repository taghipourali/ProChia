import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from './context';
import { AppError } from './lib/errors';
import { authRoutes } from './routes/auth';
import { memberRoutes } from './routes/member';
import { paymentRoutes } from './routes/payments';
import { publicRoutes } from './routes/public';
import { staffAdminRoutes } from './routes/staff/admin';
import { staffClubRoutes } from './routes/staff/club';
import { staffInventoryRoutes } from './routes/staff/inventory';
import { staffMemberRoutes } from './routes/staff/members';
import { staffMenuRoutes } from './routes/staff/menu';
import { staffOrderRoutes } from './routes/staff/orders';

const UPLOAD_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function buildApp(ctx: AppContext, opts: { logger?: boolean | object } = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(cors, {
    // Tauri serves the desktop panel from tauri://localhost (macOS/Linux) or http://tauri.localhost (Windows).
    origin: [
      ...ctx.config.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ],
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-branch'],
  });
  await app.register(rateLimit, { global: false });

  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.status)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if ('statusCode' in err && err.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'rate_limited', message: 'درخواست‌ها زیاد شد؛ کمی صبر کنید' } });
    }
    if ('validation' in err && err.validation) {
      return reply
        .status(400)
        .send({ error: { code: 'validation', message: 'اطلاعات ارسال‌شده معتبر نیست' } });
    }
    if ('statusCode' in err && err.statusCode && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code ?? 'bad_request', message: 'درخواست نامعتبر' } });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'خطای غیرمنتظره؛ دوباره تلاش کنید' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'پیدا نشد' } }),
  );

  app.get('/api/health', async () => ({ ok: true }));

  // Menu photos. In production nginx serves this directory directly; this route covers development.
  app.get<{ Params: { '*': string } }>('/uploads/*', async (req, reply) => {
    const root = path.resolve(ctx.config.UPLOAD_DIR);
    const file = path.resolve(root, req.params['*']);
    const type = UPLOAD_TYPES[path.extname(file).toLowerCase()];
    if (!file.startsWith(root + path.sep) || !type) return reply.status(404).send();
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return reply.status(404).send();
    reply
      .header('content-type', type)
      .header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(file));
  });

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

  return app;
}
