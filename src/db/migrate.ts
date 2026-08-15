import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { logger } from '../plugins/logger.js';

async function main(): Promise<void> {
  // A dedicated single connection: migrations must not share the app pool.
  const client = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    logger.info('migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'migration failed');
  process.exit(1);
});
