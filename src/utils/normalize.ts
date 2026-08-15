import { z } from 'zod';

/** Addresses are stored lowercased so the UNIQUE index actually catches dupes. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeWhitespace(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Trailing punctuation is a common artifact of the PDF export ("Estuate,"). */
export function normalizeCompany(raw: string): string {
  return normalizeWhitespace(raw).replace(/[,;:.\-]+$/, '').trim();
}

export function normalizeTitle(raw: string): string {
  return normalizeWhitespace(raw).replace(/[,;:]+$/, '').trim();
}

export function normalizeName(raw: string): string {
  return normalizeWhitespace(raw).replace(/[,;:]+$/, '').trim();
}

const emailSchema = z.string().email().max(254);

/**
 * Validity check beyond shape: reject role accounts that should never receive a
 * personal job-application email, and obviously malformed local parts.
 */
export function isValidEmail(email: string): boolean {
  if (!emailSchema.safeParse(email).success) return false;
  if (email.includes('..')) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (!domain.includes('.')) return false;
  return true;
}

const ROLE_PREFIXES = new Set([
  'noreply', 'no-reply', 'donotreply', 'postmaster', 'abuse', 'mailer-daemon',
]);

export function isRoleAccount(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return ROLE_PREFIXES.has(local);
}
