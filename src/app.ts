import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { logger } from './plugins/logger.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { templateRoutes } from './modules/templates/routes.js';
import { campaignRoutes } from './modules/campaigns/routes.js';
import { suppressionRoutes } from './modules/email/routes.js';
import { sendModeRoutes } from './modules/email/sendModeRoutes.js';
import { sql } from './db/client.js';
import { redis } from './modules/jobs/queue.js';
import { getSendModeStatus } from './modules/email/sendMode.js';

export async function buildApp() {
  const app: FastifyInstance = Fastify({
    logger: logger as FastifyBaseLogger,
    trustProxy: true,
  });

  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_MAX,
    timeWindow: env.API_RATE_LIMIT_WINDOW,
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation failed',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const status = error.statusCode ?? 500;
    // Internal errors are logged in full but never echoed to the client, which
    // keeps connection strings and credentials out of HTTP responses.
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled request error');
      return reply.code(status).send({ error: 'internal server error' });
    }
    return reply.code(status).send({ error: error.message });
  });

  app.get('/health', async () => {
    const checks = { database: false, redis: false };
    try {
      await sql`select 1`;
      checks.database = true;
    } catch {
      /* reported as false */
    }
    let sendMode: Awaited<ReturnType<typeof getSendModeStatus>> | null = null;
    try {
      sendMode = await getSendModeStatus(redis);
      checks.redis = true;
    } catch {
      /* reported as false */
    }
    return {
      status: checks.database && checks.redis ? 'ok' : 'degraded',
      // Kept for backward compatibility with existing callers/UI: reflects
      // the EFFECTIVE mode (env default, unless overridden at runtime), not
      // just the boot-time env value.
      dryRun: sendMode?.effectiveDryRun ?? env.DRY_RUN,
      sendMode,
      ...checks,
    };
  });

  await app.register(contactRoutes);
  await app.register(templateRoutes);
  await app.register(campaignRoutes);
  await app.register(suppressionRoutes);
  await app.register(sendModeRoutes);

  return app;
}
