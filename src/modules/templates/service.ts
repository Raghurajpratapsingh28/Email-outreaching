import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { emailTemplates, type EmailTemplate } from '../../db/schema.js';
import { validateTemplate, renderEmail, type RenderedEmail } from './render.js';
import { htmlToText } from './htmlToText.js';
import { getContact } from '../contacts/service.js';

export interface TemplateInput {
  name: string;
  subject: string;
  /**
   * Optional when `bodyHtml` is given: an HTML-only template auto-derives its
   * plain-text fallback from the HTML rather than requiring one to be typed
   * separately. Every send still carries a text part — mail clients that
   * can't render HTML, and spam filters that penalize text-less HTML mail,
   * both still get a real fallback; it's just generated, not hand-written.
   */
  bodyText?: string;
  bodyHtml?: string | null;
}

function resolveBodyText(input: TemplateInput): string {
  if (input.bodyText && input.bodyText.trim()) return input.bodyText;
  if (input.bodyHtml && input.bodyHtml.trim()) return htmlToText(input.bodyHtml);
  throw new Error('bodyText is required unless bodyHtml is provided');
}

/** Templates are validated on write so a bad variable fails at authoring time. */
export async function createTemplate(input: TemplateInput): Promise<EmailTemplate> {
  const bodyText = resolveBodyText(input);
  validateTemplate(input.subject);
  validateTemplate(bodyText);
  if (input.bodyHtml) validateTemplate(input.bodyHtml);

  const [row] = await db
    .insert(emailTemplates)
    .values({
      name: input.name,
      subject: input.subject,
      bodyText,
      bodyHtml: input.bodyHtml ?? null,
    })
    .returning();
  return row!;
}

export async function updateTemplate(
  id: number,
  input: Partial<TemplateInput>,
): Promise<EmailTemplate | undefined> {
  if (input.subject) validateTemplate(input.subject);
  if (input.bodyHtml) validateTemplate(input.bodyHtml);

  // bodyText is only re-derived when the caller explicitly signals an
  // HTML-only edit (bodyText sent as "" alongside a bodyHtml) — otherwise an
  // update that only touches, say, the subject must not silently overwrite a
  // hand-written plain-text body.
  const bodyText =
    input.bodyText === '' && input.bodyHtml
      ? htmlToText(input.bodyHtml)
      : input.bodyText;
  if (bodyText) validateTemplate(bodyText);

  const [row] = await db
    .update(emailTemplates)
    .set({ ...input, ...(bodyText !== undefined ? { bodyText } : {}), updatedAt: new Date() })
    .where(eq(emailTemplates.id, id))
    .returning();
  return row;
}

export async function listTemplates(): Promise<EmailTemplate[]> {
  return db.select().from(emailTemplates).orderBy(desc(emailTemplates.id));
}

export async function getTemplate(id: number): Promise<EmailTemplate | undefined> {
  const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
  return row;
}

export async function deleteTemplate(id: number): Promise<boolean> {
  const rows = await db
    .delete(emailTemplates)
    .where(eq(emailTemplates.id, id))
    .returning({ id: emailTemplates.id });
  return rows.length > 0;
}

/**
 * Renders a template against a real contact without sending. This is the
 * primary way to confirm personalization before committing to a campaign.
 */
export async function previewTemplate(
  templateId: number,
  contactId: number,
): Promise<{ to: string; contact: string } & RenderedEmail> {
  const template = await getTemplate(templateId);
  if (!template) throw new Error(`template ${templateId} not found`);

  const contact = await getContact(contactId);
  if (!contact) throw new Error(`contact ${contactId} not found`);

  const rendered = renderEmail(template, contact);
  return { to: contact.email, contact: contact.name, ...rendered };
}
