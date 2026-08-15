import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './plugins/logger.js';
import { closeDb } from './db/client.js';
import { closeQueue } from './modules/jobs/queue.js';

async function main(): Promise<void> {
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, dryRun: env.DRY_RUN }, 'API listening');

  if (env.DRY_RUN) {
    logger.warn('DRY_RUN=true — campaigns will preview only, no mail will be delivered');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down API');
    await app.close();
    await closeQueue();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
