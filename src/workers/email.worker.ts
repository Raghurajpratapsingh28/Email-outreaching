import { Worker, UnrecoverableError, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../plugins/logger.js';
import {
  EMAIL_QUEUE_NAME,
  createRedisConnection,
  type EmailJobPayload,
} from '../modules/jobs/queue.js';
import { sendEmailJob, PermanentSendError, finalizeCampaignIfDone } from '../modules/email/sender.js';
import { getSentToday, incrementSentToday, msUntilTomorrow } from '../modules/email/dailyCap.js';
import { closeTransport, verifyTransport } from '../modules/email/transport.js';
import { db, closeDb } from '../db/client.js';
import { emailJobs } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const connection = createRedisConnection();

/**
 * Sleeps out EMAIL_DELAY_MS before letting a job proceed. This is an explicit
 * floor between consecutive sends, independent of and in addition to the
 * per-minute limiter below — the limiter caps throughput over a window, this
 * guarantees no two sends are ever back-to-back.
 */
function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Email worker.
 *
 * MAX_CONCURRENT_EMAILS — capped at 5 by the env schema, defaults to 1. Gmail
 * throttles aggressively and parallel SMTP sessions from one consumer account
 * risk being flagged; concurrency above 1 is offered for accounts on Google
 * Workspace with different limits, not as a way to push a personal account
 * harder.
 *
 * EMAILS_PER_MINUTE — a hard ceiling enforced by BullMQ across the whole
 * queue, not per worker slot.
 *
 * EMAIL_DELAY_MS — an additional fixed pause before each send, so throughput
 * stays smooth even if the per-minute window would technically allow a burst.
 *
 * EMAIL_JOB_TIMEOUT_MS — if a single send hangs past this, BullMQ fails the
 * job (via lockDuration below) so a stuck SMTP connection cannot stall the
 * whole queue indefinitely.
 */
const worker = new Worker<EmailJobPayload>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobPayload>) => {
    const { emailJobId } = job.data;

    // Daily cap check. Rather than failing, the job is re-delayed to tomorrow so
    // a large campaign naturally spreads across days instead of erroring out.
    const sentToday = await getSentToday(connection);
    if (sentToday >= env.EMAIL_DAILY_CAP) {
      const delayMs = msUntilTomorrow();
      logger.warn({ sentToday, cap: env.EMAIL_DAILY_CAP, delayMs }, 'daily cap reached — deferring');
      await job.moveToDelayed(Date.now() + delayMs, job.token);
      return { deferred: true };
    }

    await delay(env.EMAIL_DELAY_MS);

    try {
      const outcome = await sendEmailJob(emailJobId);
      if (outcome.kind === 'sent') await incrementSentToday(connection);

      const [row] = await db
        .select({ campaignId: emailJobs.campaignId })
        .from(emailJobs)
        .where(eq(emailJobs.id, emailJobId))
        .limit(1);
      if (row) await finalizeCampaignIfDone(row.campaignId);

      return outcome;
    } catch (err) {
      // A hard bounce must not consume the retry budget.
      if (err instanceof PermanentSendError) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  },
  {
    connection,
    concurrency: env.MAX_CONCURRENT_EMAILS,
    limiter: { max: env.EMAILS_PER_MINUTE, duration: 60_000 },
    // The lock must outlive EMAIL_JOB_TIMEOUT_MS with headroom, or BullMQ
    // would reclaim (and re-run) a job that is merely slow, not stuck.
    lockDuration: env.EMAIL_JOB_TIMEOUT_MS + 10_000,
  },
);

worker.on('completed', (job) => {
  logger.debug({ jobId: job.id }, 'queue job completed');
});

worker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
    'queue job failed',
  );
});

worker.on('error', (err) => {
  logger.error({ err: err.message }, 'worker error');
});

async function main(): Promise<void> {
  if (env.DRY_RUN) {
    logger.warn('DRY_RUN=true — no email will be delivered');
  } else {
    const ok = await verifyTransport();
    if (!ok) {
      logger.fatal('SMTP verification failed — refusing to start worker');
      process.exit(1);
    }
  }
  logger.info(
    {
      concurrency: env.MAX_CONCURRENT_EMAILS,
      emailsPerMinute: env.EMAILS_PER_MINUTE,
      emailDelayMs: env.EMAIL_DELAY_MS,
      jobTimeoutMs: env.EMAIL_JOB_TIMEOUT_MS,
      dailyCap: env.EMAIL_DAILY_CAP,
    },
    'email worker started',
  );
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down worker');
  // Lets the in-flight send finish so it is never left in an ambiguous state.
  await worker.close();
  await closeTransport();
  await connection.quit();
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main();
