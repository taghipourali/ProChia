/**
 * Builds the demo database: runs the API migrations and the real seed (three weeks of simulated
 * history) against PGlite in Node, then dumps the data directory. The browser starts from this
 * dump, so opening the demo does not replay thousands of queries.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { branches } from '../../api/src/db/schema';
import { seedDemo } from '../../api/src/db/seed/demo';
import { demoConfig } from '../src/runtime/config';
import { demoDb, PARSERS } from '../src/runtime/db';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../.data/demo-data.tgz');

const started = Date.now();
// 1 MB WAL segments (instead of 16 MB) that are deleted rather than recycled keep the dump, and
// every snapshot the browser saves of it, small.
const pg = new PGlite({
  parsers: PARSERS,
  initDbStartParams: ['--wal-segsize=1'],
  postgresqlconf: ['wal_recycle = off', 'min_wal_size = 2MB', 'max_wal_size = 8MB'],
});
const db = demoDb(pg);
await migrate(db as never, { migrationsFolder: path.resolve(here, '../../api/drizzle') });
await seedDemo({ db, config: demoConfig(), password: 'prochia1234' });

// Anyone trying the demo signs in with their own number, so skip the whitelist.
const [branch] = await db.select().from(branches).where(eq(branches.slug, 'demo'));
await db
  .update(branches)
  .set({ settings: { ...branch!.settings, memberApproval: 'auto' } })
  .where(eq(branches.id, branch!.id));
await db.execute(sql`create table demo_meta (anchor timestamptz not null)`);
await db.execute(sql`insert into demo_meta values (now())`);

await pg.exec('vacuum full');
await pg.exec('checkpoint');
await pg.query('select pg_switch_wal()');
await pg.exec('checkpoint');
const dump = await pg.dumpDataDir('gzip');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, Buffer.from(await dump.arrayBuffer()));
await pg.close();
console.log(
  `demo data: ${(dump.size / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s → ${path.relative(process.cwd(), out)}`,
);
