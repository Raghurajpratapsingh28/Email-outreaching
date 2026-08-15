import type { Contact } from '../../db/schema.js';

/**
 * Template rendering for {{variable}} placeholders.
 *
 * Two deliberate design rules:
 *
 * 1. `{{name}}` is the contact's FULL NAME ("Akanksha Puri"). `{{firstName}}`
 *    is the derived first name ("Akanksha") and is the one to use in a
 *    greeting — "Dear {{firstName}}," not "Dear {{name}},". `{{fullName}}` is
 *    kept as an explicit alias of `{{name}}` for templates that prefer the
 *    more self-documenting spelling.
 *
 * 2. Unknown or empty variables THROW instead of rendering "". Silently
 *    emitting "opportunities at ." is worse than failing loudly, because the
 *    broken email would go out to a real hiring contact.
 */

export const TEMPLATE_VARIABLES = [
  'name',
  'firstName',
  'fullName',
  'title',
  'company',
  'email',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export class TemplateRenderError extends Error {
  constructor(
    message: string,
    readonly variable?: string,
  ) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export type RenderContext = Pick<
  Contact,
  'name' | 'firstName' | 'email' | 'title' | 'company'
>;

export function buildContext(contact: RenderContext): Record<TemplateVariable, string> {
  return {
    name: contact.name,
    firstName: contact.firstName,
    fullName: contact.name,
    title: contact.title ?? '',
    company: contact.company ?? '',
    email: contact.email,
  };
}

/** Variables referenced by a template, for validation before a campaign starts. */
export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) found.add(m[1]!);
  return [...found];
}

export function validateTemplate(template: string): void {
  const unknown = extractVariables(template).filter(
    (v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v),
  );
  if (unknown.length > 0) {
    throw new TemplateRenderError(
      `Unknown template variable(s): ${unknown.map((u) => `{{${u}}}`).join(', ')}. ` +
        `Supported: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}`,
      unknown[0],
    );
  }
}

export interface RenderOptions {
  /** HTML-escape substituted values. Enable for the HTML body only. */
  escapeHtml?: boolean;
}

export function render(
  template: string,
  contact: RenderContext,
  options: RenderOptions = {},
): string {
  validateTemplate(template);
  const ctx = buildContext(contact);

  return template.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey as TemplateVariable;
    let value = ctx[key];

    // A missing first name has a safe, non-fatal fallback: the greeting still
    // needs *something*, and the full name is the closest honest substitute.
    // Every other variable (title, company, email) still fails loudly, because
    // there is no substitute that wouldn't misrepresent the contact.
    if ((key === 'firstName' || key === 'name') && (value === undefined || value.trim() === '')) {
      value = ctx.fullName?.trim() || contact.email.split('@')[0] || '';
    }

    if (value === undefined || value.trim() === '') {
      throw new TemplateRenderError(
        `Cannot render {{${key}}} for <${contact.email}>: value is empty. ` +
          `Fix the contact record or remove the variable from the template.`,
        key,
      );
    }
    return options.escapeHtml ? escapeHtml(value) : value;
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}

export function renderEmail(
  template: { subject: string; bodyText: string; bodyHtml: string | null },
  contact: RenderContext,
): RenderedEmail {
  return {
    // Subject lines are plain text — escaping here would leak "&amp;" into inboxes.
    subject: render(template.subject, contact),
    bodyText: render(template.bodyText, contact),
    bodyHtml: template.bodyHtml
      ? render(template.bodyHtml, contact, { escapeHtml: true })
      : null,
  };
}
