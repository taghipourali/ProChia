import { loadConfig } from './config';
import { buildApp } from './app';
import type { AppContext } from './context';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { advisoryLock, Scheduler } from './jobs/scheduler';
import { EventBus } from './lib/bus';
import { createSmsProvider } from './modules/notifications/providers';
import { createGateway } from './modules/payments/gateways';

const config = loadConfig();
await runMigrations(config.DATABASE_URL);

const { db, pool } = createDb(config.DATABASE_URL);
const logger =
  config.NODE_ENV === 'development'
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level: 'info' };

const ctx: AppContext = {
  config,
  db,
  bus: new EventBus(),
  sms: createSmsProvider(config),
  gateway: createGateway(config),
  now: () => new Date(),
};

const app = await buildApp(ctx, { logger });
const scheduler = new Scheduler(ctx, advisoryLock(pool, app.log), app.log);
if (config.RUN_SCHEDULER) scheduler.start();

await app.listen({ port: config.PORT, host: config.HOST });

const shutdown = async () => {
  await scheduler.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
