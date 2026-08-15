import pdf from 'pdf-parse';

/**
 * PDF contact parser.
 *
 * The source PDF is a table exported without cell delimiters, so extracted text
 * arrives as glued records:
 *
 *   "1Akanksha Puriakanksha.puri@sourcefuse.comAssociate Director HRSourceFuse Technologies"
 *
 * There is no separator between name/email, or between title/company. Each
 * boundary therefore needs its own recovery strategy:
 *
 *   1. Record boundary  — the leading serial number, validated as a sequence.
 *   2. Email boundary   — anchored on "@", walking outward to a valid TLD.
 *   3. Name | localpart — the name is Capitalized, the local part is not.
 *   4. Title | company  — scored against the email domain, plus a title
 *                         vocabulary learned from high-confidence rows.
 *
 * Rows whose company cannot be corroborated by the domain are flagged
 * `low` confidence rather than dropped: many are legitimately mismatched
 * (anindita.ranjan@3ds.com really does work at "Dassault Systems"), so a human
 * reviews them instead of the parser guessing.
 */

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ParsedContact {
  sno: number;
  name: string;
  firstName: string;
  email: string;
  title: string;
  company: string;
  confidence: ParseConfidence;
}

export interface ParseReport {
  contacts: ParsedContact[];
  totalRecords: number;
  unparsed: string[];
  confidenceCounts: Record<ParseConfidence, number>;
}

/**
 * Known TLDs, longest-first so multi-label suffixes (".co.in", ".com.br")
 * resolve to the longest valid match.
 *
 * This list is a fast path, not the authority. Because the text is glued, the
 * TLD is what tells us where the address ends — but an unlisted TLD must not
 * silently drop a real contact, so `TLD_FALLBACK` below accepts any plausible
 * suffix that is followed by a capital letter (the start of the job title).
 */
const TLDS = [
  'com', 'in', 'co', 'io', 'ai', 'net', 'org', 'tech', 'digital', 'us', 'uk', 'edu', 'biz',
  'info', 'me', 'cloud', 'dev', 'app', 'ch', 'de', 'sg', 'au', 'ca', 'fr', 'nl', 'se', 'es',
  'it', 'jp', 'cn', 'solutions', 'systems', 'global', 'world', 'group', 'life', 'online',
  'site', 'xyz', 'pro', 'work', 'agency', 'consulting', 'services', 'software', 'technology',
  'media', 'store', 'one', 'live', 'team', 'company', 'email', 'tv', 'ly', 'sh', 'fm', 'is',
  'to', 'cc', 'ie', 'be', 'dk', 'no', 'fi', 'pl', 'pt', 'ru', 'za', 'nz', 'my', 'ph', 'id',
  'vn', 'th', 'hk', 'kr', 'tw', 'ae', 'sa', 'il', 'tr', 'gr', 'cz', 'hu', 'ro', 'ua', 'by',
  'kz', 'ge', 'am', 'az', 'gg', 'iq', 'cx', 'asia', 'engineering', 'engineer', 'network',
  'ventures', 'partners', 'capital', 'health', 'finance', 'games', 'design', 'studio', 'space',
  'zone', 'today', 'social', 'careers', 'jobs', 'academy', 'institute', 'labs', 'systems',
].sort((a, b) => b.length - a.length);

const TLD_RE = new RegExp(`^(${TLDS.join('|')})`, 'i');

/**
 * Fallback for TLDs not in the list: a run of letters that ends exactly where a
 * capital letter begins. In this PDF the job title always follows the email and
 * always starts capitalized, so that transition is a reliable terminator.
 */
const TLD_FALLBACK = /^([a-z]{2,20})(?=[A-Z]|$)/;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Reflow raw text lines into one string per record.
 *
 * A new record starts only when a line begins with the next expected serial
 * number. Long emails wrap mid-address across lines, and those continuation
 * fragments must be appended to the current record rather than starting a new
 * one — checking the sequence, not merely "starts with a digit", is what makes
 * this reliable.
 */
export function reflowRecords(text: string): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^SNo/i.test(l));

  const records: string[] = [];
  for (const line of lines) {
    const m = /^(\d{1,5})(\D.*)$/.exec(line);
    if (m && Number(m[1]) === records.length + 1) {
      records.push(m[1]! + m[2]!);
    } else if (records.length > 0) {
      records[records.length - 1] += line;
    }
  }
  return records;
}

/** Locate the email inside a glued record by anchoring on "@". */
function extractEmailSpan(rest: string): { start: number; end: number } | null {
  const at = rest.indexOf('@');
  if (at < 0) return null;

  let start = at;
  while (start > 0 && /[A-Za-z0-9._%+-]/.test(rest[start - 1]!)) start--;

  let i = at + 1;
  let end = -1;
  while (i < rest.length) {
    const ch = rest[i]!;
    if (ch === '.') {
      const after = rest.slice(i + 1);
      const t = TLD_RE.exec(after) ?? TLD_FALLBACK.exec(after);
      if (t) {
        const cand = i + 1 + t[1]!.length;
        // A dot immediately after means more labels follow (e.g. ".co.in").
        if (rest[cand] === '.') {
          i = cand;
          continue;
        }
        end = cand;
        break;
      }
      i++;
    } else if (/[A-Za-z0-9-]/.test(ch)) {
      i++;
    } else break;
  }
  if (end < 0) return null;
  return { start, end };
}

/**
 * Split "<CapitalizedSurname><lowercase local part>" — e.g. "Puriakanksha.puri".
 *
 * Scored rather than rule-based, because the strongest signal is that the local
 * part usually restates the person's own name. Splits that leave a two-character
 * local part are penalized, but not forbidden: initial-style addresses like
 * "nk@ezesoft.com" for "Nitya K" are real and must survive.
 */
function splitNameAndEmail(
  leadingName: string,
  gluedEmail: string,
): { name: string; email: string } {
  const at = gluedEmail.indexOf('@');
  if (at < 0) return { name: leadingName, email: gluedEmail.toLowerCase() };

  const glued = gluedEmail.slice(0, at);
  const domain = gluedEmail.slice(at);
  const firstLower = leadingName.toLowerCase().replace(/[^a-z]/g, '');

  let best: { surname: string; local: string; score: number } | null = null;

  for (let k = 0; k <= glued.length; k++) {
    const surname = glued.slice(0, k);
    const local = glued.slice(k);
    if (!local || !/^[a-z0-9]/.test(local)) continue;
    if (surname && !/^[A-Z]/.test(surname)) continue;
    if (/[A-Z]/.test(local)) continue;
    if (/[._-]$/.test(local)) continue;

    const surLower = surname.toLowerCase();
    const nameLetters = firstLower + surLower;
    let score = 0;

    if (firstLower.length >= 3 && local.startsWith(firstLower)) score += 50;
    else if (surLower && local.startsWith(surLower)) score += 30;
    else if (firstLower.startsWith(local.replace(/[^a-z]/g, ''))) score += 8;

    for (const part of local.split(/[._-]/).filter(Boolean)) {
      if (part.length >= 3 && nameLetters.includes(part)) score += part.length * 3;
      else if (part.length >= 3 && part.startsWith(firstLower.slice(0, 3))) score += 4;
    }

    if (surname) {
      // A single capital is a legitimate surname in this dataset ("Nitya K",
      // "Anand K"), and those rows pair with initials-style addresses.
      if (/^[A-Z]$/.test(surname)) score += 3;
      else score += /^[A-Z][a-z]+$/.test(surname) ? Math.min(surname.length, 10) : -8;
    }
    if (surLower && local.includes(surLower)) score += surLower.length * 2;

    // Initials addresses: "Nitya K" -> "nk@", "Anand K" -> "ak@". Recognize the
    // local part as the surname initial followed by the first name's initial or
    // stem, which is otherwise indistinguishable from a truncated split.
    const initials = (surLower[0] ?? '') + (firstLower[0] ?? '');
    const localStem = local.replace(/[^a-z]/g, '');
    if (localStem.length >= 2 && localStem.length <= 3) {
      if (localStem === initials || localStem === `${firstLower[0] ?? ''}${surLower[0] ?? ''}`) {
        score += 18;
      }
    }

    if (local.replace(/[^a-z0-9]/g, '').length <= 1) score -= 20;
    else if (local.replace(/[^a-z0-9]/g, '').length === 2) score -= 4;

    if (!best || score > best.score || (score === best.score && local.length > best.local.length)) {
      best = { surname, local, score };
    }
  }

  if (!best) return { name: leadingName, email: gluedEmail.toLowerCase() };
  return {
    name: `${leadingName} ${best.surname}`.trim().replace(/\s+/g, ' '),
    email: (best.local + domain).toLowerCase(),
  };
}

/** How strongly a candidate company string is corroborated by the email domain. */
function domainScore(company: string, domain: string): number {
  const ck = norm(company);
  if (!ck || !domain) return 0;
  if (ck === domain) return 60;
  if (domain.startsWith(ck) || ck.startsWith(domain)) return 50;

  const first = norm(company.split(/\s+/)[0] ?? '');
  if (first.length >= 4 && (domain.includes(first) || first.includes(domain))) return 40;
  if (first.length >= 3 && domain.startsWith(first)) return 25;

  const initials = company
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toLowerCase();
  if (initials.length >= 3 && domain.startsWith(initials)) return 22;
  return 0;
}

interface SplitCandidate {
  index: number;
  title: string;
  company: string;
}

/** Every position where a company could plausibly begin (a capital letter). */
function splitCandidates(tail: string): SplitCandidate[] {
  const out: SplitCandidate[] = [];
  for (let i = 1; i < tail.length; i++) {
    if (!/[A-Z]/.test(tail[i]!)) continue;
    const title = tail.slice(0, i).trim().replace(/[,\-\s]+$/, '');
    const company = tail
      .slice(i)
      .trim()
      .replace(/^[,\-\s]+/, '')
      .replace(/,$/, '');
    if (title && company) out.push({ index: i, title, company });
  }
  return out;
}

const TITLE_HINT =
  /\b(HR|Human|Talent|People|Recruit\w*|Director|Head|Officer|President|Manager|Chief|VP|AVP|Acquisition|Operations)\b/i;
const COMPANY_ANTI_HINT = /\b(Director|Head|Officer|President|Recruitment)\b/i;

export async function parseContactsPdf(buffer: Buffer): Promise<ParseReport> {
  const { text } = await pdf(buffer);
  const records = reflowRecords(text);

  // --- Stage 1: serial / name / email / remainder --------------------------
  interface Stage1 {
    sno: number;
    name: string;
    email: string;
    tail: string;
  }
  const stage1: Stage1[] = [];
  const unparsed: string[] = [];

  for (const record of records) {
    const m = /^(\d{1,5})(.*)$/.exec(record);
    if (!m) {
      unparsed.push(record);
      continue;
    }
    const rest = m[2]!;
    const span = extractEmailSpan(rest);
    if (!span) {
      unparsed.push(record);
      continue;
    }
    const { name, email } = splitNameAndEmail(
      rest.slice(0, span.start).trim(),
      rest.slice(span.start, span.end),
    );
    stage1.push({ sno: Number(m[1]), name, email, tail: rest.slice(span.end).trim() });
  }

  // --- Stage 2: learn title vocabulary from rows the domain already confirms.
  // Bootstrapping from unambiguous rows lets the parser resolve boundaries that
  // no fixed dictionary could ("...Human Resources Global" + "Pyxis One", where
  // the domain is pixis.ai).
  const titleWordCounts = new Map<string, number>();
  for (const row of stage1) {
    const domain = norm(row.email.split('@')[1]?.split('.')[0] ?? '');
    let confident: SplitCandidate | null = null;
    let bestScore = 0;
    for (const cand of splitCandidates(row.tail)) {
      const s = domainScore(cand.company, domain);
      if (s >= 40 && s > bestScore) {
        bestScore = s;
        confident = cand;
      }
    }
    if (!confident) continue;
    for (const w of confident.title.split(/[\s,\-()/&]+/)) {
      if (w.length > 1) titleWordCounts.set(w, (titleWordCounts.get(w) ?? 0) + 1);
    }
  }

  const titleScore = (s: string): number => {
    const words = s.split(/[\s,\-()/&]+/).filter((w) => w.length > 1);
    if (words.length === 0) return 0;
    let hits = 0;
    for (const w of words) if ((titleWordCounts.get(w) ?? 0) >= 3) hits++;
    return hits / words.length;
  };

  // --- Stage 3: final title/company split ----------------------------------
  const contacts: ParsedContact[] = [];
  const confidenceCounts: Record<ParseConfidence, number> = { high: 0, medium: 0, low: 0 };

  for (const row of stage1) {
    const domain = norm(row.email.split('@')[1]?.split('.')[0] ?? '');
    let best: { title: string; company: string; score: number; domain: number } | null = null;

    for (const cand of splitCandidates(row.tail)) {
      const ds = domainScore(cand.company, domain);
      // Reward a title that reads like a title; punish a "company" that does.
      let score = ds + titleScore(cand.title) * 30 - titleScore(cand.company) * 25;
      if (/[a-z]/.test(row.tail[cand.index - 1] ?? '')) score += 2;
      if (TITLE_HINT.test(cand.title)) score += 8;
      if (COMPANY_ANTI_HINT.test(cand.company)) score -= 12;
      score -= Math.abs(cand.company.length - 16) * 0.04;

      if (!best || score > best.score) {
        best = { title: cand.title, company: cand.company, score, domain: ds };
      }
    }

    const title = best?.title ?? row.tail;
    const company = best?.company ?? '';
    const confidence: ParseConfidence =
      (best?.domain ?? 0) >= 40 ? 'high' : (best?.domain ?? 0) > 0 ? 'medium' : 'low';
    confidenceCounts[confidence]++;

    contacts.push({
      sno: row.sno,
      name: row.name,
      firstName: deriveFirstName(row.name),
      email: row.email,
      title,
      company,
      confidence,
    });
  }

  return { contacts, totalRecords: records.length, unparsed, confidenceCounts };
}

/**
 * The salutation value. This must never be a job title — "Dear Associate
 * Director HR," is exactly the failure mode this system exists to avoid — so it
 * is derived only from the name column and stored explicitly.
 *
 * Honorifics are stripped; a bare honorific never becomes the greeting.
 */
export function deriveFirstName(fullName: string): string {
  const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sri', 'smt', 'shri']);
  const tokens = fullName
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  for (const token of tokens) {
    const bare = token.replace(/[.,]/g, '').toLowerCase();
    if (HONORIFICS.has(bare)) continue;
    return token.replace(/[.,]$/, '');
  }
  return tokens[0]?.replace(/[.,]$/, '') ?? fullName.trim();
}
