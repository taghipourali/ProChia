import { types, type PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { Db } from '../../../api/src/db/client';
import * as schema from '../../../api/src/db/schema';

/** Same as the API's node-postgres setup: bigint and numeric aggregates come back as numbers. */
export const PARSERS = {
  [types.INT8]: (v: string) => Number(v),
  [types.NUMERIC]: (v: string) => Number(v),
};

/**
 * The services are typed against node-postgres; the PGlite driver exposes the same query builder,
 * so the cast only swaps the driver type.
 */
export function demoDb(pg: PGlite): Db {
  return drizzle(pg, { schema, casing: 'snake_case' }) as unknown as Db;
}

const HOUR = 3_600_000;

/**
 * The seeded history is anchored to the moment the data was built. When the demo is opened later,
 * every timestamp moves forward by the gap (dates by whole Tehran days), so "today" always has live
 * orders and the charts end today.
 */
export async function shiftToNow(db: Db, now = new Date()) {
  const [meta] = (
    await db.execute<{ anchor: string }>(sql`select anchor::text as anchor from demo_meta`)
  ).rows;
  if (!meta) return 0;
  const anchor = new Date(meta.anchor);
  const gapMs = now.getTime() - anchor.getTime();
  if (gapMs < 6 * HOUR) return 0;

  const days = Math.round(
    (Date.parse(tehranDay(now)) - Date.parse(tehranDay(anchor))) / (24 * HOUR),
  );
  const columns = (
    await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name <> 'demo_meta'
        and data_type in ('timestamp with time zone', 'timestamp without time zone', 'date')
    `)
  ).rows;
  // Dates are part of unique keys (order numbers per business day), which Postgres checks row by
  // row; parking them far in the future first means no row ever lands on another's old date.
  const PARK = 100_000;
  const phases = [new Map<string, string[]>(), new Map<string, string[]>()];
  for (const c of columns) {
    const col = `"${c.column_name}"`;
    const add = (phase: number, expr: string) => {
      const sets = phases[phase]!.get(c.table_name) ?? [];
      phases[phase]!.set(c.table_name, [...sets, `${col} = ${expr}`]);
    };
    if (c.data_type === 'date') {
      add(0, `${col} + ${days + PARK}`);
      add(1, `${col} - ${PARK}`);
    } else {
      add(0, `${col} + interval '${Math.round(gapMs / 1000)} seconds'`);
    }
  }
  await db.transaction(async (tx) => {
    for (const phase of phases) {
      for (const [table, sets] of phase) {
        await tx.execute(sql.raw(`update "${table}" set ${sets.join(', ')}`));
      }
    }
    await tx.execute(sql`update demo_meta set anchor = ${now}`);
  });
  return gapMs;
}

function tehranDay(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d);
}
