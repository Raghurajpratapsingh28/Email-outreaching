import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const contactStatus = pgEnum('contact_status', ['active', 'disabled', 'bounced']);
export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'running',
  'paused',
  'completed',
]);
export const emailJobStatus = pgEnum('email_job_status', [
  'pending',
  'queued',
  'sent',
  'failed',
  'skipped',
]);
export const emailEventType = pgEnum('email_event_type', [
  'queued',
  'sent',
  'failed',
  'retried',
  'skipped',
  'dry_run',
]);
export const parseConfidence = pgEnum('parse_confidence', ['high', 'medium', 'low']);

/**
 * `first_name` is stored, not derived at render time. The salutation is the
 * most visible part of the email, so the value that lands in "Dear {{name}},"
 * is computed once at import and is inspectable/correctable in the database.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: serial('id').primaryKey(),
    sno: integer('sno'),
    name: text('name').notNull(),
    firstName: text('first_name').notNull(),
    email: text('email').notNull(),
    title: text('title'),
    company: text('company'),
    status: contactStatus('status').notNull().default('active'),
    confidence: parseConfidence('confidence').notNull().default('high'),
    source: text('source'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Case-insensitive uniqueness: Gmail treats addresses case-insensitively,
    // so storing normalized-lowercase and enforcing UNIQUE here is what
    // actually prevents mailing the same person twice.
    emailUnique: uniqueIndex('contacts_email_unique').on(t.email),
    statusIdx: index('contacts_status_idx').on(t.status),
    companyIdx: index('contacts_company_idx').on(t.company),
  }),
);

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: uniqueIndex('email_templates_name_unique').on(t.name),
  }),
);

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  templateId: integer('template_id')
    .notNull()
    .references(() => emailTemplates.id, { onDelete: 'restrict' }),
  status: campaignStatus('status').notNull().default('draft'),
  dryRun: boolean('dry_run').notNull().default(true),
  ratePerMinute: integer('rate_per_minute').notNull().default(20),
  dailyCap: integer('daily_cap').notNull().default(400),
  // Frozen filter used to materialize recipients, kept for auditability.
  contactFilter: jsonb('contact_filter'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * The rendered subject/body are persisted at enqueue time so that a dry-run
 * preview is byte-identical to what would be sent, and so editing a template
 * cannot retroactively change already-queued mail.
 */
export const emailJobs = pgTable(
  'email_jobs',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    contactId: integer('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    status: emailJobStatus('status').notNull().default('pending'),
    toEmail: text('to_email').notNull(),
    renderedSubject: text('rendered_subject').notNull(),
    renderedBodyText: text('rendered_body_text').notNull(),
    renderedBodyHtml: text('rendered_body_html'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    messageId: text('message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The real duplicate-send guarantee. Application-level checks race under
    // retries and concurrent starts; this constraint does not.
    campaignContactUnique: uniqueIndex('email_jobs_campaign_contact_unique').on(
      t.campaignId,
      t.contactId,
    ),
    statusIdx: index('email_jobs_status_idx').on(t.status),
    campaignStatusIdx: index('email_jobs_campaign_status_idx').on(t.campaignId, t.status),
  }),
);

export const emailEvents = pgTable(
  'email_events',
  {
    id: serial('id').primaryKey(),
    emailJobId: integer('email_job_id')
      .notNull()
      .references(() => emailJobs.id, { onDelete: 'cascade' }),
    type: emailEventType('type').notNull(),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobIdx: index('email_events_job_idx').on(t.emailJobId),
  }),
);

export const suppressionList = pgTable(
  'suppression_list',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('suppression_list_email_unique').on(t.email),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type EmailJob = typeof emailJobs.$inferSelect;
