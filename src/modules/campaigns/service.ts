import { and, eq, gte, lte, ilike, notInArray, sql, desc, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  campaigns,
  contacts,
  emailJobs,
  emailEvents,
  suppressionList,
  type Campaign,
} from '../../db/schema.js';
import { getTemplate } from '../templates/service.js';
import { renderEmail, TemplateRenderError } from '../templates/render.js';
import { enqueueEmail } from '../jobs/queue.js';
import { logger } from '../../plugins/logger.js';
import { getContact } from '../contacts/service.js';

export interface ContactFilter {
  company?: string;
  confidence?: 'high' | 'medium' | 'low';
  contactIds?: number[];
  /** Inclusive serial-number range — e.g. "send to SNo 100 through 200". */
  snoFrom?: number;
  snoTo?: number;
  limit?: number;
}

export interface CreateCampaignInput {
  name: string;
  templateId: number;
  contactFilter?: ContactFilter;
  dryRun?: boolean;
  ratePerMinute?: number;
  dailyCap?: number;
}

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const template = await getTemplate(input.templateId);
  if (!template) throw new Error(`template ${input.templateId} not found`);

  const [row] = await db
    .insert(campaigns)
    .values({
      name: input.name,
      templateId: input.templateId,
      contactFilter: input.contactFilter ?? {},
      dryRun: input.dryRun ?? true,
      ratePerMinute: input.ratePerMinute ?? 20,
      dailyCap: input.dailyCap ?? 400,
    })
    .returning();
  return row!;
}

/** Active, non-suppressed contacts matching the campaign's filter. */
async function selectRecipients(filter: ContactFilter) {
  const suppressed = db.select({ email: suppressionList.email }).from(suppressionList);

  const conditions: SQL[] = [eq(contacts.status, 'active')];
  if (filter.company) conditions.push(ilike(contacts.company, `%${filter.company}%`));
  if (filter.confidence) conditions.push(eq(contacts.confidence, filter.confidence));
  if (filter.contactIds && filter.contactIds.length > 0) {
    conditions.push(sql`${contacts.id} = ANY(${filter.contactIds})`);
  }
  if (filter.snoFrom !== undefined) conditions.push(gte(contacts.sno, filter.snoFrom));
  if (filter.snoTo !== undefined) conditions.push(lte(contacts.sno, filter.snoTo));
  conditions.push(notInArray(contacts.email, suppressed));

  // When targeting a serial range, send in that same order — so "100 to 200"
  // reliably starts at 100, not in arbitrary id order.
  const orderBy = filter.snoFrom !== undefined || filter.snoTo !== undefined
    ? contacts.sno
    : contacts.id;

  const q = db
    .select()
    .from(contacts)
    .where(and(...conditions))
    .orderBy(orderBy);

  return filter.limit ? q.limit(filter.limit) : q;
}

export interface StartResult {
  campaignId: number;
  recipients: number;
  queued: number;
  alreadyQueued: number;
  renderErrors: { contactId: number; email: string; error: string }[];
}

/**
 * Materializes and enqueues a campaign.
 *
 * Safe to call repeatedly: the unique constraint on (campaign_id, contact_id)
 * means re-running only picks up contacts that were not already materialized,
 * so a partial failure can simply be retried.
 */
export async function startCampaign(campaignId: number): Promise<StartResult> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (campaign.status === 'completed') throw new Error('campaign already completed');

  const template = await getTemplate(campaign.templateId);
  if (!template) throw new Error(`template ${campaign.templateId} not found`);

  const filter = (campaign.contactFilter ?? {}) as ContactFilter;
  const recipients = await selectRecipients(filter);

  const result: StartResult = {
    campaignId,
    recipients: recipients.length,
    queued: 0,
    alreadyQueued: 0,
    renderErrors: [],
  };

  await db
    .update(campaigns)
    .set({ status: 'running', startedAt: campaign.startedAt ?? new Date() })
    .where(eq(campaigns.id, campaignId));

  for (const contact of recipients) {
    let rendered;
    try {
      // Rendered once, here, and stored — so a later template edit cannot
      // change what an already-queued recipient receives.
      rendered = renderEmail(template, contact);
    } catch (err) {
      const message = err instanceof TemplateRenderError ? err.message : (err as Error).message;
      result.renderErrors.push({ contactId: contact.id, email: contact.email, error: message });
      continue;
    }

    const inserted = await db
      .insert(emailJobs)
      .values({
        campaignId,
        contactId: contact.id,
        toEmail: contact.email,
        renderedSubject: rendered.subject,
        renderedBodyText: rendered.bodyText,
        renderedBodyHtml: rendered.bodyHtml,
        status: 'queued',
      })
      .onConflictDoNothing({ target: [emailJobs.campaignId, emailJobs.contactId] })
      .returning({ id: emailJobs.id });

    const jobRow = inserted[0];
    if (!jobRow) {
      // Constraint hit — this contact was already materialized for this campaign.
      result.alreadyQueued++;
      continue;
    }

    await db.insert(emailEvents).values({
      emailJobId: jobRow.id,
      type: 'queued',
      meta: { to: contact.email },
    });

    await enqueueEmail({ emailJobId: jobRow.id });
    result.queued++;
  }

  logger.info(
    {
      campaignId,
      recipients: result.recipients,
      queued: result.queued,
      alreadyQueued: result.alreadyQueued,
      renderErrors: result.renderErrors.length,
    },
    'campaign started',
  );

  return result;
}

export async function pauseCampaign(campaignId: number): Promise<Campaign | undefined> {
  const [row] = await db
    .update(campaigns)
    .set({ status: 'paused' })
    .where(eq(campaigns.id, campaignId))
    .returning();
  return row;
}

export async function resumeCampaign(campaignId: number): Promise<StartResult> {
  await db.update(campaigns).set({ status: 'running' }).where(eq(campaigns.id, campaignId));
  // Re-enqueue anything left behind while paused.
  const pending = await db
    .select({ id: emailJobs.id })
    .from(emailJobs)
    .where(and(eq(emailJobs.campaignId, campaignId), eq(emailJobs.status, 'queued')));

  for (const job of pending) await enqueueEmail({ emailJobId: job.id });

  return {
    campaignId,
    recipients: pending.length,
    queued: pending.length,
    alreadyQueued: 0,
    renderErrors: [],
  };
}

export async function listCampaigns(): Promise<Campaign[]> {
  return db.select().from(campaigns).orderBy(desc(campaigns.id));
}

export async function getCampaignStats(campaignId: number) {
  const rows = await db
    .select({ status: emailJobs.status, count: sql<number>`count(*)::int` })
    .from(emailJobs)
    .where(eq(emailJobs.campaignId, campaignId))
    .groupBy(emailJobs.status);

  const stats = { pending: 0, queued: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
  for (const r of rows) {
    stats[r.status] = r.count;
    stats.total += r.count;
  }
  return stats;
}

/** Preview what a campaign would send, without materializing anything. */
export async function previewCampaign(campaignId: number, limit = 5) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);

  const template = await getTemplate(campaign.templateId);
  if (!template) throw new Error(`template ${campaign.templateId} not found`);

  const filter = (campaign.contactFilter ?? {}) as ContactFilter;
  const recipients = (await selectRecipients({ ...filter, limit })).slice(0, limit);

  return recipients.map((contact) => {
    try {
      const r = renderEmail(template, contact);
      return { to: contact.email, name: contact.name, ok: true as const, ...r };
    } catch (err) {
      return {
        to: contact.email,
        name: contact.name,
        ok: false as const,
        error: (err as Error).message,
      };
    }
  });
}

/**
 * Renders the campaign's template against one specific contact — the exact
 * email that contact would receive if the campaign were live. Nothing is
 * queued or persisted; this is a pure render.
 */
export async function previewCampaignForContact(
  campaignId: number,
  contactId: number,
): Promise<{ to: string; subject: string; text: string; html: string | null }> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);

  const template = await getTemplate(campaign.templateId);
  if (!template) throw new Error(`template ${campaign.templateId} not found`);

  const contact = await getContact(contactId);
  if (!contact) throw new Error(`contact ${contactId} not found`);

  const rendered = renderEmail(template, contact);
  return { to: contact.email, subject: rendered.subject, text: rendered.bodyText, html: rendered.bodyHtml };
}
