/**
 * Contact import CLI — the path from source PDF to populated database.
 *
 *   npm run import:contacts -- ./data/hr-contacts.pdf
 *   npm run import:contacts -- ./data/hr-contacts.pdf --dry
 *
 * `--dry` parses and reports without writing anything, which is the
 * recommended first run — it shows exactly how names, titles, and companies
 * were split before any row reaches the database.
 */
import { readFile } from 'node:fs/promises';
import { importFromPdf } from '../src/modules/contacts/service.js';
import { parseContactsPdf } from '../src/modules/contacts/parser.js';
import { closeDb } from '../src/db/client.js';

function printReport(r: {
  totalRecords: number;
  successfullyParsed: number;
  invalidEmails: { sno: number; name: string; email: string; reason: string }[];
  duplicateEmails: number;
  incompleteRecords: { sno: number; name: string; email: string; missing: string[] }[];
  skippedRecords: number;
}): void {
  console.log('\nImport report');
  console.log('─'.repeat(60));
  console.log(`  total records found:     ${r.totalRecords}`);
  console.log(`  successfully parsed:     ${r.successfullyParsed}`);
  console.log(`  invalid emails:          ${r.invalidEmails.length}`);
  console.log(`  duplicate emails:        ${r.duplicateEmails}`);
  console.log(`  incomplete records:      ${r.incompleteRecords.length}  (stored — missing title/company, nothing invented)`);
  console.log(`  skipped records:         ${r.skippedRecords}  (line(s) could not be parsed into a record at all)`);
  console.log('─'.repeat(60));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const dry = args.includes('--dry');

  if (!path) {
    console.error('usage: npm run import:contacts -- <file.pdf> [--dry]');
    process.exit(1);
  }

  const buffer = await readFile(path);

  if (dry) {
    const report = await parseContactsPdf(buffer);
    console.log(`\nParsed ${report.contacts.length} of ${report.totalRecords} records (dry run — nothing written)`);
    console.log(
      `Confidence — high: ${report.confidenceCounts.high}, ` +
        `medium: ${report.confidenceCounts.medium}, low: ${report.confidenceCounts.low}`,
    );
    console.log(`Unparsed lines: ${report.unparsed.length}\n`);
    console.log('First 10 parsed contacts:');
    for (const c of report.contacts.slice(0, 10)) {
      console.log(
        `  ${String(c.sno).padStart(4)}  ${c.name}  <${c.email}>\n` +
          `        title:   ${c.title || '(none)'}\n` +
          `        company: ${c.company || '(none)'}\n` +
          `        "Dear {{firstName}}" -> "Dear ${c.firstName},"  [confidence: ${c.confidence}]`,
      );
    }
    if (report.confidenceCounts.low > 0) {
      console.log(`\nLow-confidence rows (company not corroborated by the email domain):`);
      for (const c of report.contacts.filter((x) => x.confidence === 'low').slice(0, 10)) {
        console.log(`  ${c.sno}  [${c.title}] | [${c.company}]  ${c.email}`);
      }
    }
    return;
  }

  const result = await importFromPdf(buffer, path);
  printReport(result);
  console.log(`  inserted:                ${result.imported}`);
  console.log(`  updated:                 ${result.updated}`);

  if (result.invalidEmails.length > 0) {
    console.log('\nInvalid emails (rejected — not stored):');
    for (const r of result.invalidEmails.slice(0, 20)) {
      console.log(`  ${r.sno}  ${r.name}  <${r.email}>  — ${r.reason}`);
    }
    if (result.invalidEmails.length > 20) {
      console.log(`  ... and ${result.invalidEmails.length - 20} more`);
    }
  }

  if (result.incompleteRecords.length > 0) {
    console.log('\nIncomplete records (stored, flagged — missing field(s) left null/empty, not invented):');
    for (const r of result.incompleteRecords.slice(0, 20)) {
      console.log(`  ${r.sno}  ${r.name}  <${r.email}>  — missing: ${r.missing.join(', ')}`);
    }
    if (result.incompleteRecords.length > 20) {
      console.log(`  ... and ${result.incompleteRecords.length - 20} more`);
    }
  }

  if (result.lowConfidence.length > 0) {
    console.log(
      `\n${result.lowConfidence.length} contacts have a title/company split that could not be ` +
        `verified against the email domain. Review via:\n` +
        `  GET /contacts?confidence=low`,
    );
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
