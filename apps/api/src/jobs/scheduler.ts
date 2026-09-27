import type { Pool, PoolClient } from 'pg';
import { tehranIsoDate, tehranParts } from '@prochia/shared';
import type { AppContext } from '../context';
import { drainSmsOutbox } from '../modules/notifications/sms';
import { releaseDueTickets } from '../modules/orders/service';
import { expireStalePayments } from '../modules/payments/service';
import {
  birthdayGifts,
  createScheduledOrders,
  refreshAllTiers,
  subscriptionMaintenance,
} from './tasks';

const LOCK_KEY = 704_210_001;

interface Job {
  name: string;
  everyMs: number;
  run: (ctx: AppContext) => Promise<unknown>;
}

const JOBS: Job[] = [
  { name: 'release-tickets', everyMs: 15_000, run: releaseDueTickets },
  { name: 'sms-outbox', everyMs: 5_000, run: (ctx) => drainSmsOutbox(ctx) },
  { name: 'stale-payments', everyMs: 60_000, run: expireStalePayments },
  { name: 'scheduled-orders', everyMs: 5 * 60_000, run: createScheduledOrders },
  { name: 'subscriptions', everyMs: 30 * 60_000, run: subscriptionMaintenance },
];

/** Runs once per Tehran day, after the given local hour. */
const DAILY: { name: string; afterHour: number; run: (ctx: AppContext) => Promise<unknown> }[] = [
  { name: 'birthdays', afterHour: 9, run: birthdayGifts },
  { name: 'tiers', afterHour: 4, run: refreshAllTiers },
];

/** Decides which process runs the jobs. */
export interface Leadership {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Only one API process runs the jobs: the first to take a Postgres advisory lock. Others keep
 * trying, so a replacement takes over if the leader dies.
 */
export function advisoryLock(
  pool: Pool,
  log: { info: (m: string) => void } = { info: () => {} },
): Leadership {
  let client: PoolClient | null = null;
  return {
    async acquire() {
      if (client) return true;
      const c = await pool.connect();
      const { rows } = await c.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [
        LOCK_KEY,
      ]);
      if (rows[0]?.ok) {
        client = c;
        log.info('scheduler: acquired leadership');
        return true;
      }
      c.release();
      return false;
    },
    async release() {
      if (!client) return;
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
      client.release();
      client = null;
    },
  };
}

/** Background work, run by whichever process holds the leadership. */
export class Scheduler {
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly lastRun = new Map<string, number>();
  private readonly lastDaily = new Map<string, string>();
  private running = new Set<string>();

  constructor(
    private readonly ctx: AppContext,
    private readonly leadership: Leadership,
    private readonly log: { error: (o: unknown, m?: string) => void },
  ) {}

  start() {
    this.timers.push(setInterval(() => void this.tick(), 5_000));
    void this.tick();
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.leadership.release();
  }

  private async tick() {
    try {
      if (!(await this.leadership.acquire())) return;
    } catch (err) {
      this.log.error(err, 'scheduler: leadership check failed');
      return;
    }
    const now = this.ctx.now();
    for (const job of JOBS) {
      if (now.getTime() - (this.lastRun.get(job.name) ?? 0) < job.everyMs) continue;
      this.lastRun.set(job.name, now.getTime());
      void this.runJob(job.name, job.run);
    }
    const today = tehranIsoDate(now);
    const hour = tehranParts(now).hour;
    for (const job of DAILY) {
      if (hour < job.afterHour || this.lastDaily.get(job.name) === today) continue;
      this.lastDaily.set(job.name, today);
      void this.runJob(job.name, job.run);
    }
  }

  private async runJob(name: string, run: (ctx: AppContext) => Promise<unknown>) {
    if (this.running.has(name)) return;
    this.running.add(name);
    try {
      await run(this.ctx);
    } catch (err) {
      this.log.error(err, `scheduler: ${name} failed`);
    } finally {
      this.running.delete(name);
    }
  }
}
