import { eq, and, sql as raw } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { campaigns, contacts, emailEvents, emailJobs, suppressionList } from '../../db/schema.js';
import { env } from '../../config/env.js';
import { logger } from '../../plugins/logger.js';
import { getTransporter, classifyFailure } from './transport.js';
import { redis } from '../jobs/queue.js';
import { getEffectiveDryRun } from './sendMode.js';

export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentSendError';
  }
}

export type SendOutcome =
  | { kind: 'sent'; messageId: string }
  | { kind: 'dry_run' }
  | { kind: 'skipped'; reason: string };

async function recordEvent(
  emailJobId: number,
  type: 'queued' | 'sent' | 'failed' | 'retried' | 'skipped' | 'dry_run',
  meta?: Record<string, unknown>,
): Promise<void> {
  await db.insert(emailEvents).values({ emailJobId, type, meta: meta ?? null });
}

/**
 * Sends one email job.
 *
 * Ordering matters here. Every cheap guard runs before SMTP is touched, and the
 * `sent` transition is written before the function returns so a crash cannot
 * leave a delivered email marked pending — which would resend it.
 */
export async function sendEmailJob(emailJobId: number): Promise<SendOutcome> {
  const [job] = await db.select().from(emailJobs).where(eq(emailJobs.id, emailJobId)).limit(1);
  if (!job) throw new PermanentSendError(`email_job ${emailJobId} not found`);

  // Guard 1: already delivered. Protects against a duplicate queue entry or a
  // retry that fires after a successful send.
  if (job.status === 'sent') {
    logger.warn({ emailJobId }, 'job already sent — skipping duplicate delivery');
    return { kind: 'skipped', reason: 'already_sent' };
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, job.campaignId))
    .limit(1);
  if (!campaign) throw new PermanentSendError(`campaign ${job.campaignId} not found`);

  // Guard 2: a paused campaign must stop mid-flight, not drain its backlog.
  if (campaign.status === 'paused') {
    return { kind: 'skipped', reason: 'campaign_paused' };
  }

  // Guard 3: re-check suppression at send time. A contact may be suppressed
  // after the job was queued; checking only at enqueue would mail someone who
  // has since opted out.
  const [suppressed] = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(eq(suppressionList.email, job.toEmail))
    .limit(1);

  if (suppressed) {
    await markSkipped(job.id, 'suppressed');
    return { kind: 'skipped', reason: 'suppressed' };
  }

  // Guard 4: contact disabled since enqueue.
  const [contact] = await db
    .select({ status: contacts.status, sno: contacts.sno })
    .from(contacts)
    .where(eq(contacts.id, job.contactId))
    .limit(1);

  if (!contact || contact.status !== 'active') {
    await markSkipped(job.id, `contact_${contact?.status ?? 'missing'}`);
    return { kind: 'skipped', reason: 'contact_inactive' };
  }

  // Carried through every log line below so a serial-number-range campaign
  // ("send SNo 100 to 200") is traceable in the worker log without joining
  // back to the database.
  const sno = contact.sno;

  // Guard 5: dry run. The effective global switch (env default, unless
  // overridden at runtime via the API/frontend — see sendMode.ts) always
  // overrides the per-campaign setting, so one place controls whether ANY
  // mail leaves this system regardless of stored campaign config.
  const globalDryRun = await getEffectiveDryRun(redis);
  if (globalDryRun || campaign.dryRun) {
    await db
      .update(emailJobs)
      .set({ status: 'skipped', lastError: null, updatedAt: new Date() })
      .where(eq(emailJobs.id, job.id));
    await recordEvent(job.id, 'dry_run', { to: job.toEmail, subject: job.renderedSubject, sno });
    logger.info(
      { emailJobId: job.id, sno, to: job.toEmail, subject: job.renderedSubject },
      'DRY RUN — not sent',
    );
    return { kind: 'dry_run' };
  }

  // --- Actual delivery -----------------------------------------------------
  try {
    // A stable, campaign/job-scoped Message-ID (rather than Nodemailer's
    // random default) makes a specific send traceable end-to-end: the same id
    // appears in the SMTP transcript, the recipient's headers, and this row.
    const messageId = `<job-${job.id}.${job.campaignId}@${env.MAIL_FROM_EMAIL.split('@')[1]}>`;

    const info = await getTransporter().sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
      // Individual send: exactly one recipient, never BCC. Recipients must not
      // be able to see one another, and personalization requires one message
      // per contact.
      to: job.toEmail,
      replyTo: env.MAIL_REPLY_TO ?? env.MAIL_FROM_EMAIL,
      subject: job.renderedSubject,
      text: job.renderedBodyText,
      ...(job.renderedBodyHtml ? { html: job.renderedBodyHtml } : {}),
      messageId,
    });

    await db
      .update(emailJobs)
      .set({
        status: 'sent',
        messageId: info.messageId ?? null,
        sentAt: new Date(),
        lastError: null,
        attempts: raw`${emailJobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(emailJobs.id, job.id));

    await recordEvent(job.id, 'sent', { messageId: info.messageId, to: job.toEmail, sno });
    logger.info({ emailJobId: job.id, sno, to: job.toEmail }, 'email sent');

    return { kind: 'sent', messageId: info.messageId ?? '' };
  } catch (err) {
    const message = (err as Error).message;
    const kind = classifyFailure(err);

    await db
      .update(emailJobs)
      .set({
        status: kind === 'permanent' ? 'failed' : 'pending',
        lastError: message.slice(0, 1000),
        attempts: raw`${emailJobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(emailJobs.id, job.id));

    await recordEvent(job.id, kind === 'permanent' ? 'failed' : 'retried', {
      error: message.slice(0, 500),
      kind,
      sno,
    });

    if (kind === 'permanent') {
      logger.error(
        { emailJobId: job.id, sno, to: job.toEmail, err: message },
        'permanent send failure',
      );
      // Swallowed rather than rethrown: BullMQ must not retry a hard bounce.
      throw new PermanentSendError(message);
    }

    logger.warn({ emailJobId: job.id, sno, err: message }, 'transient send failure — will retry');
    throw err;
  }
}

async function markSkipped(emailJobId: number, reason: string): Promise<void> {
  await db
    .update(emailJobs)
    .set({ status: 'skipped', lastError: reason, updatedAt: new Date() })
    .where(eq(emailJobs.id, emailJobId));
  await recordEvent(emailJobId, 'skipped', { reason });
  logger.info({ emailJobId, reason }, 'email job skipped');
}

/** Marks a campaign completed once no work remains. */
export async function finalizeCampaignIfDone(campaignId: number): Promise<void> {
  const [row] = await db
    .select({ remaining: raw<number>`count(*)::int` })
    .from(emailJobs)
    .where(
      and(
        eq(emailJobs.campaignId, campaignId),
        raw`${emailJobs.status} in ('pending', 'queued')`,
      ),
    );

  if ((row?.remaining ?? 0) === 0) {
    await db
      .update(campaigns)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    logger.info({ campaignId }, 'campaign completed');
  }
}
