import { loadConfig } from '../../config';
import { createDb } from '../client';
import { runMigrations } from '../migrate';
import { seedDemo } from './demo';

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
const { db, pool } = createDb(config.DATABASE_URL);
try {
  await seedDemo({
    db,
    config,
    reset: process.argv.includes('--reset'),
    password: process.env.SEED_PASSWORD,
  });
} finally {
  await pool.end();
}
