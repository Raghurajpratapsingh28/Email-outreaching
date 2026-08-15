import { and, eq, gte, lte, ilike, or, sql, desc, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { contacts, type Contact } from '../../db/schema.js';
import { parseContactsPdf, deriveFirstName, type ParsedContact } from './parser.js';
import {
  isValidEmail,
  isRoleAccount,
  normalizeCompany,
  normalizeEmail,
  normalizeName,
  normalizeTitle,
} from '../../utils/normalize.js';
import { logger } from '../../plugins/logger.js';

export interface ImportResult {
  /** Total records found in the source file, before any filtering. */
  totalRecords: number;
  /** Records that produced a valid, storable contact (inserted or updated). */
  successfullyParsed: number;
  imported: number;
  updated: number;
  /** Same email appearing more than once within this file. */
  duplicateEmails: number;
  /** Rejected outright — malformed address, role account, or missing name. */
  invalidEmails: { sno: number; name: string; email: string; reason: string }[];
  /** Parsed and stored, but missing title or company — nothing was invented. */
  incompleteRecords: { sno: number; name: string; email: string; missing: string[] }[];
  /** Company/title recovered but not corroborated by the email domain. */
  lowConfidence: { sno: number; name: string; title: string; company: string }[];
  /** Lines in the source file that could not be parsed into a record at all. */
  skippedRecords: number;
}

/**
 * Imports contacts from the HR-contacts PDF.
 *
 * Duplicates are resolved in two places: within the file (first occurrence
 * wins) and against the table (ON CONFLICT). Both are needed — the file itself
 * contains repeat addresses, and imports get re-run.
 */
export async function importFromPdf(buffer: Buffer, source = 'pdf'): Promise<ImportResult> {
  const report = await parseContactsPdf(buffer);

  const result: ImportResult = {
    totalRecords: report.totalRecords,
    successfullyParsed: 0,
    imported: 0,
    updated: 0,
    duplicateEmails: 0,
    invalidEmails: [],
    incompleteRecords: [],
    lowConfidence: [],
    skippedRecords: report.unparsed.length,
  };

  const seen = new Set<string>();
  const toInsert: {
    sno: number;
    name: string;
    firstName: string;
    email: string;
    title: string;
    company: string;
    confidence: ParsedContact['confidence'];
    source: string;
  }[] = [];

  for (const raw of report.contacts) {
    const email = normalizeEmail(raw.email);
    const name = normalizeName(raw.name);

    if (!isValidEmail(email)) {
      result.invalidEmails.push({ sno: raw.sno, name, email, reason: 'malformed address' });
      continue;
    }
    if (isRoleAccount(email)) {
      result.invalidEmails.push({ sno: raw.sno, name, email, reason: 'role account' });
      continue;
    }
    if (!name) {
      result.invalidEmails.push({ sno: raw.sno, name, email, reason: 'missing name' });
      continue;
    }
    if (seen.has(email)) {
      result.duplicateEmails++;
      continue;
    }
    seen.add(email);

    const title = normalizeTitle(raw.title);
    const company = normalizeCompany(raw.company);

    const missing: string[] = [];
    if (!title) missing.push('title');
    if (!company) missing.push('company');
    if (missing.length > 0) {
      result.incompleteRecords.push({ sno: raw.sno, name, email, missing });
    }

    if (raw.confidence === 'low') {
      result.lowConfidence.push({ sno: raw.sno, name, title, company });
    }

    result.successfullyParsed++;
    toInsert.push({
      sno: raw.sno,
      name,
      firstName: deriveFirstName(name),
      email,
      title,
      company,
      confidence: raw.confidence,
      source,
    });
  }

  // Chunked to stay well under Postgres' parameter limit.
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const rows = await db
      .insert(contacts)
      .values(chunk)
      .onConflictDoUpdate({
        target: contacts.email,
        set: {
          name: sql`excluded.name`,
          firstName: sql`excluded.first_name`,
          title: sql`excluded.title`,
          company: sql`excluded.company`,
          confidence: sql`excluded.confidence`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: contacts.id, createdAt: contacts.createdAt, updatedAt: contacts.updatedAt });

    for (const r of rows) {
      if (r.createdAt.getTime() === r.updatedAt.getTime()) result.imported++;
      else result.updated++;
    }
  }

  logger.info(
    {
      total: result.totalRecords,
      successfullyParsed: result.successfullyParsed,
      imported: result.imported,
      updated: result.updated,
      duplicateEmails: result.duplicateEmails,
      invalidEmails: result.invalidEmails.length,
      incompleteRecords: result.incompleteRecords.length,
      lowConfidence: result.lowConfidence.length,
      skippedRecords: result.skippedRecords,
    },
    'contact import complete',
  );

  return result;
}

export interface ListContactsQuery {
  status?: 'active' | 'disabled' | 'bounced';
  company?: string;
  confidence?: 'high' | 'medium' | 'low';
  q?: string;
  /** Inclusive serial-number range, matching the PDF's original SNo column. */
  snoFrom?: number;
  snoTo?: number;
  limit: number;
  offset: number;
}

export async function listContacts(
  query: ListContactsQuery,
): Promise<{ items: Contact[]; total: number }> {
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(contacts.status, query.status));
  if (query.confidence) filters.push(eq(contacts.confidence, query.confidence));
  if (query.company) filters.push(ilike(contacts.company, `%${query.company}%`));
  if (query.snoFrom !== undefined) filters.push(gte(contacts.sno, query.snoFrom));
  if (query.snoTo !== undefined) filters.push(lte(contacts.sno, query.snoTo));
  if (query.q) {
    const like = `%${query.q}%`;
    const m = or(
      ilike(contacts.name, like),
      ilike(contacts.email, like),
      ilike(contacts.company, like),
      ilike(contacts.title, like),
    );
    if (m) filters.push(m);
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  // Serial-number order matters here: when a caller is browsing by SNo range,
  // results should read in that same order, not most-recently-imported-first.
  const orderBy =
    query.snoFrom !== undefined || query.snoTo !== undefined
      ? [contacts.sno]
      : [desc(contacts.id)];

  const [items, [countRow]] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(where),
  ]);

  return { items, total: countRow?.count ?? 0 };
}

export async function getContact(id: number): Promise<Contact | undefined> {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return row;
}

export async function updateContactStatus(
  id: number,
  status: 'active' | 'disabled' | 'bounced',
): Promise<Contact | undefined> {
  const [row] = await db
    .update(contacts)
    .set({ status, updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  return row;
}

export async function updateContact(
  id: number,
  patch: Partial<Pick<Contact, 'name' | 'firstName' | 'title' | 'company'>>,
): Promise<Contact | undefined> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    set.name = normalizeName(patch.name);
    // Keep the salutation consistent when a name is corrected, unless the
    // caller overrides it explicitly below.
    set.firstName = deriveFirstName(normalizeName(patch.name));
  }
  if (patch.firstName !== undefined) set.firstName = normalizeName(patch.firstName);
  if (patch.title !== undefined) set.title = patch.title === null ? null : normalizeTitle(patch.title);
  if (patch.company !== undefined) {
    set.company = patch.company === null ? null : normalizeCompany(patch.company);
  }

  const [row] = await db.update(contacts).set(set).where(eq(contacts.id, id)).returning();
  return row;
}
