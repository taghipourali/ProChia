import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(connectionString: string) {
  const { db, pool } = createDb(connectionString);
  try {
    // The bundle ships migrations next to itself (dist/drizzle); from source they live in apps/api/drizzle.
    const migrationsFolder = [
      path.resolve(here, 'drizzle'),
      path.resolve(here, '../../drizzle'),
    ].find((p) => existsSync(p));
    if (!migrationsFolder) throw new Error('migrations folder not found');
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
