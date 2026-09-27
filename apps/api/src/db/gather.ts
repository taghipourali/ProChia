import { is } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Executor } from './client';

/**
 * Runs independent queries concurrently on the pool, but one after another inside a transaction,
 * which owns a single connection that cannot run queries in parallel.
 */
export async function gather<T extends readonly (() => Promise<unknown>)[]>(
  db: Executor,
  tasks: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  type Out = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
  if (is(db, PgTransaction)) {
    const out: unknown[] = [];
    for (const task of tasks) out.push(await task());
    return out as Out;
  }
  return (await Promise.all(tasks.map((task) => task()))) as Out;
}
