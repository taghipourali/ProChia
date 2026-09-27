import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything queries can run on: the pool or an open transaction. */
export type Executor = Db | Tx;

// Return `numeric` / `bigint` aggregates (sum, count) as JS numbers instead of strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}

/**
 * Runs independent queries concurrently on the pool, but one after another inside a transaction,
 * which owns a single connection that cannot run queries in parallel.
 */
export async function gather<T extends readonly (() => Promise<unknown>)[]>(
  db: Executor,
  tasks: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  type Out = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
  if (db instanceof PgTransaction) {
    const out: unknown[] = [];
    for (const task of tasks) out.push(await task());
    return out as Out;
  }
  return (await Promise.all(tasks.map((task) => task()))) as Out;
}
