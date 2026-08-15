import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env.js';

export const EMAIL_QUEUE_NAME = 'email-send';

/** BullMQ requires maxRetriesPerRequest: null on the connection it blocks on. */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export const redis = createRedisConnection();

/**
 * The payload carries only an id. The database is the source of truth for
 * recipient and rendered content, so a job that sits in Redis across a
 * deployment can never send stale or superseded content.
 */
export interface EmailJobPayload {
  emailJobId: number;
}

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: env.EMAIL_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  },
});

export async function enqueueEmail(
  payload: EmailJobPayload,
  opts: JobsOptions = {},
): Promise<void> {
  await emailQueue.add('send', payload, {
    // Deterministic job id: re-enqueueing the same email job is a no-op in
    // BullMQ, which complements the DB unique constraint.
    jobId: `email-${payload.emailJobId}`,
    ...opts,
  });
}

export async function closeQueue(): Promise<void> {
  await emailQueue.close();
  await redis.quit();
}
