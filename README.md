# Job Outreach Email System

A personal backend for sending individually personalized job-outreach emails
to HR/Talent Acquisition contacts, sourced from a PDF contact list. Built for
single-operator use — no login system, no multi-tenant concerns.

**Core guarantee: every email is sent as its own SMTP message to a single
recipient.** There is no BCC path anywhere in the codebase. Recipients never
see each other, and every message is rendered individually from the contact's
own name, title, and company.

---

## Table of contents

1. [What this project does](#1-what-this-project-does)
2. [Architecture](#2-architecture)
3. [Folder structure](#3-folder-structure)
4. [Prerequisites](#4-prerequisites)
5. [Installation](#5-installation)
6. [PostgreSQL setup](#6-postgresql-setup)
7. [Redis setup](#7-redis-setup)
8. [Gmail SMTP setup](#8-gmail-smtp-setup)
9. [Gmail App Password setup](#9-gmail-app-password-setup)
10. [Environment variables](#10-environment-variables)
11. [Database migrations](#11-database-migrations)
12. [PDF import](#12-pdf-import)
13. [Creating a template](#13-creating-a-template)
14. [Creating a campaign](#14-creating-a-campaign)
15. [Previewing an email](#15-previewing-an-email)
16. [Launching a campaign](#16-launching-a-campaign)
17. [Pausing / resuming](#17-pausing--resuming)
18. [Monitoring jobs](#18-monitoring-jobs)
19. [Running the worker](#19-running-the-worker)
20. [Running in Docker](#20-running-in-docker)
21. [Troubleshooting](#21-troubleshooting)
22. [Security considerations](#22-security-considerations)

---

## 1. What this project does

You have a PDF of HR contacts (name, email, title, company). This system:

1. **Parses** the PDF into structured contact records — even though the source
   PDF has no delimiters between fields (see [§12](#12-pdf-import)).
2. **Stores** contacts in PostgreSQL, deduplicated by email.
3. Lets you write a **template** with `{{firstName}}`, `{{name}}`, `{{title}}`,
   `{{company}}`, `{{email}}` placeholders.
4. Lets you create a **campaign** — a template applied to a filtered set of
   contacts — and **preview** the exact rendered email for any contact before
   anything is sent.
5. On explicit launch, **queues one job per recipient** in Redis/BullMQ and a
   background **worker** sends them one at a time through Gmail SMTP, at a
   rate you control.
6. Tracks delivery status per contact, retries transient failures, and never
   sends the same contact the same campaign twice.

Nothing is ever sent as a side effect of creating or previewing a campaign.
Sending requires an explicit "launch" call, and even then `DRY_RUN=true` (the
default) intercepts every send before it reaches SMTP.

---

## 2. Architecture

Two long-running processes share one PostgreSQL database and one Redis
instance:

```
                         ┌────────────────────┐
  HTTP requests  ─────▶  │   API (Fastify)     │
  (curl / your tools)    │   src/server.ts      │
                         └─────────┬───────────┘
                                   │ reads/writes
                                   ▼
                         ┌────────────────────┐
                         │    PostgreSQL       │◀───────────┐
                         │  contacts,           │            │ reads/writes
                         │  templates,           │            │
                         │  campaigns,            │            │
                         │  email_jobs,            │           │
                         │  email_events,           │          │
                         │  suppression_list         │         │
                         └─────────┬───────────┘            │
                                   │ campaign launch          │
                                   │ enqueues one BullMQ       │
                                   │ job per recipient          │
                                   ▼                          │
                         ┌────────────────────┐              │
                         │   Redis (BullMQ)     │              │
                         └─────────┬───────────┘              │
                                   │ worker pulls jobs           │
                                   ▼                            │
                         ┌────────────────────┐                │
                         │  Worker (BullMQ)      │────────────────┘
                         │  src/workers/          │
                         │  email.worker.ts         │
                         └─────────┬───────────┘
                                   │ one SMTP call per job
                                   ▼
                         ┌────────────────────┐
                         │   Gmail SMTP          │
                         │  smtp.gmail.com:465    │
                         └────────────────────┘
```

**Why two processes instead of one script:** SMTP is slow (hundreds of
milliseconds per send) and deliberately rate-limited. Sending inline inside an
HTTP request handler would block the API and lose in-flight work if the
process restarted mid-campaign. Splitting API and worker means:

- The API stays responsive regardless of how many emails are queued.
- The worker can restart, crash, or be redeployed without losing queued work —
  BullMQ persists jobs in Redis (with `appendonly yes`), and every job is
  idempotent by database constraint (see [§10 duplicate protection](#duplicate-send-protection)).
- You can scale send throughput (or slow it down) by changing worker
  concurrency without touching the API at all.

**Why the database, not Redis, is the source of truth for content:** each
BullMQ job payload is just `{ emailJobId: number }`. The rendered subject/body
are read from Postgres at send time, not carried in the Redis payload. This
means editing a template later cannot retroactively change mail that's already
queued (that mail was rendered and frozen into `email_jobs` at launch time),
and a dry-run preview is byte-identical to what would actually ship.

---

## 3. Folder structure

```
.
├── src/
│   ├── config/
│   │   └── env.ts                 Zod-validated environment, fails fast at boot
│   ├── db/
│   │   ├── schema.ts              Drizzle table definitions (source of truth)
│   │   ├── client.ts              Postgres connection pool
│   │   └── migrate.ts             Migration runner (npm run db:migrate)
│   ├── modules/
│   │   ├── contacts/
│   │   │   ├── parser.ts          PDF → structured contacts (the hard part)
│   │   │   ├── service.ts         Import, list, update, dedupe
│   │   │   └── routes.ts          /contacts endpoints
│   │   ├── templates/
│   │   │   ├── render.ts          {{variable}} substitution engine
│   │   │   ├── service.ts         CRUD + preview-against-a-contact
│   │   │   └── routes.ts          /templates endpoints
│   │   ├── campaigns/
│   │   │   ├── service.ts         Recipient selection, launch, pause, stats
│   │   │   └── routes.ts          /campaigns endpoints
│   │   ├── email/
│   │   │   ├── transport.ts       Nodemailer transport, SMTP verification
│   │   │   ├── sender.ts          Per-job send logic + all safety guards
│   │   │   ├── dailyCap.ts        Redis-backed daily send counter
│   │   │   └── routes.ts          /suppression endpoints
│   │   └── jobs/
│   │       └── queue.ts           BullMQ queue definition
│   ├── workers/
│   │   └── email.worker.ts        Standalone worker process entrypoint
│   ├── plugins/
│   │   └── logger.ts              Pino logger with credential redaction
│   ├── utils/
│   │   └── normalize.ts           Email/name/title/company normalization
│   ├── app.ts                     Fastify app construction (no listen())
│   └── server.ts                  API process entrypoint
├── scripts/
│   └── import-contacts.ts         CLI: npm run import:contacts -- <file.pdf>
├── drizzle/
│   └── 0000_*.sql                 Generated SQL migration(s)
├── drizzle.config.ts
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── tsconfig.json
└── package.json
```

Two entrypoints, two processes: `src/server.ts` (API, never sends mail) and
`src/workers/email.worker.ts` (worker, never serves HTTP).

---

## 4. Prerequisites

- **Node.js 20+** (project uses ES modules and top-level `await` throughout)
- **PostgreSQL 14+** (locally installed or via Docker)
- **Redis 6+** (locally installed or via Docker)
- **A Gmail account** with 2-Step Verification enabled (for the App Password)
- **npm** (comes with Node)

Check versions:

```bash
node -v      # v20.x or higher
npm -v
```

---

## 5. Installation

```bash
git clone <this-repo>          # or just cd into the project directory
cd Email

npm install

cp .env.example .env
# edit .env — see §10 for what each variable means
```

Nothing runs yet. You need Postgres and Redis reachable, and the schema
migrated, before starting the API or worker.

---

## 6. PostgreSQL setup

Two ways to get a database. Pick one.

### Option A — Docker (recommended, isolated)

```bash
docker compose up -d postgres
```

This creates a `postgres:16-alpine` container with:

- database: `outreach`
- user: `outreach`
- password: `outreach`
- port `5432` published to the host

Matches the default `DATABASE_URL` in `.env.example` exactly — no changes
needed if you use Docker.

### Option B — Local Homebrew/apt install

```bash
# macOS
brew install postgresql@16
brew services start postgresql@16

# create the role and database
psql -d postgres -c "CREATE ROLE outreach LOGIN PASSWORD 'outreach' SUPERUSER;"
createdb -O outreach outreach

# verify
psql "postgresql://outreach:outreach@localhost:5432/outreach" -c "select 1;"
```

Either way, `DATABASE_URL` in `.env` should end up as:

```
DATABASE_URL=postgresql://outreach:outreach@localhost:5432/outreach
```

If you use a different user/password/database name, update `DATABASE_URL` to
match — every other command in this doc assumes the value above.

---

## 7. Redis setup

### Option A — Docker (recommended)

```bash
docker compose up -d redis
```

Runs `redis:7-alpine` with `--appendonly yes` (AOF persistence — queued jobs
survive a container restart) on port `6379`.

### Option B — Local install

```bash
# macOS
brew install redis
brew services start redis

# verify
redis-cli ping     # should print PONG
```

`.env` default:

```
REDIS_URL=redis://localhost:6379
```

---

## 8. Gmail SMTP setup

This system sends through Gmail's SMTP relay, not the Gmail API — meaning any
Gmail (or Google Workspace) account works with no OAuth app registration.

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your.address@gmail.com
SMTP_PASSWORD=<see §9 — this must be an App Password, not your login password>
```

`SMTP_PORT=465` with `SMTP_SECURE=true` uses implicit TLS (SMTPS) — the
connection is encrypted from the first byte, which is what Gmail expects on
that port. Don't switch to port 587 without also setting `SMTP_SECURE=false`
(STARTTLS) — mismatching the two will hang or fail the connection.

`MAIL_FROM_EMAIL` should normally equal `SMTP_USER` — Gmail will silently
rewrite the From address to the authenticated account if they don't match, on
most account types.

---

## 9. Gmail App Password setup

**Your normal Google password will not work.** Google disabled plain-password
SMTP login years ago ("less secure apps"). You need an **App Password**: a
16-character, single-purpose token.

1. **Enable 2-Step Verification** on the Gmail account, if not already on:
   https://myaccount.google.com/security → "2-Step Verification" → follow the
   prompts. This is a hard requirement — App Passwords don't exist without it.

2. **Generate the App Password:**
   https://myaccount.google.com/apppasswords
   - Select app: "Mail" (or "Other" → name it "job-outreach")
   - Google shows a 16-character password like `abcd efgh ijkl mnop`

3. **Paste it into `.env`:**
   ```
   SMTP_PASSWORD=abcd efgh ijkl mnop
   ```
   Spaces are fine — the app strips all whitespace from this value
   automatically before using it, so copy-pasting directly from Google's UI
   works without editing.

4. **Never commit this value.** `.env` is gitignored. Only `.env.example`
   (with `SMTP_PASSWORD=` empty) is tracked.

5. **Revoking access:** if the password is ever exposed, delete it from
   https://myaccount.google.com/apppasswords and generate a new one — no need
   to change your actual Google account password.

To confirm the credential works before running a real campaign, start the
worker with `DRY_RUN=false` — it calls `transporter.verify()` on boot and
refuses to start if authentication fails, rather than failing silently on the
first send:

```
[worker] SMTP verification failed — check SMTP_USER and that SMTP_PASSWORD is a Gmail App Password
```

---

## 10. Environment variables

Full reference for every variable in `.env.example`. All are validated at
process boot (both API and worker) via a Zod schema in `src/config/env.ts` —
an invalid or missing required value stops the process immediately with a
clear message, rather than failing confusingly later.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` / `test` / `production`. Controls log formatting (pretty in dev, JSON in prod) and DB pool size. |
| `PORT` | no | `3000` | API listen port. |
| `HOST` | no | `0.0.0.0` | API bind address. |
| `LOG_LEVEL` | no | `info` | Pino level: `fatal`/`error`/`warn`/`info`/`debug`/`trace`. |
| `DATABASE_URL` | **yes** | — | Postgres connection string. |
| `REDIS_URL` | **yes** | — | Redis connection string, used by BullMQ. |
| `SMTP_HOST` | no | `smtp.gmail.com` | SMTP relay host. |
| `SMTP_PORT` | no | `465` | SMTP port. |
| `SMTP_SECURE` | no | `true` | `true` = implicit TLS (port 465). `false` = STARTTLS (port 587). |
| `SMTP_USER` | **yes** | — | Full Gmail address. |
| `SMTP_PASSWORD` | **yes** | — | Gmail **App Password** (see §9). Whitespace stripped automatically. Never logged. |
| `MAIL_FROM_NAME` | **yes** | — | Display name recipients see, e.g. `Raghuraj Pratap Singh`. |
| `MAIL_FROM_EMAIL` | **yes** | — | Envelope From address — should match `SMTP_USER`. |
| `MAIL_REPLY_TO` | no | `MAIL_FROM_EMAIL` | Reply-To header, if different from the From address. |
| `EMAILS_PER_MINUTE` | no | `20` | Hard ceiling enforced by BullMQ across the whole send queue. |
| `EMAIL_DELAY_MS` | no | `2000` | Fixed pause before every individual send, independent of the per-minute limiter. |
| `MAX_CONCURRENT_EMAILS` | no | `1` | Worker concurrency — number of SMTP sends allowed in flight at once. Capped at 5. |
| `EMAIL_JOB_TIMEOUT_MS` | no | `30000` | Per-send timeout (SMTP socket timeout). A hung connection fails the job instead of stalling the queue forever. |
| `EMAIL_DAILY_CAP` | no | `400` | Max recipients/day. Jobs beyond this defer to the next UTC day rather than error. |
| `EMAIL_MAX_ATTEMPTS` | no | `5` | Retry ceiling for transient SMTP failures (exponential backoff). |
| `DRY_RUN` | no | `true` | **Global kill switch.** When `true`, nothing is ever handed to SMTP, regardless of any per-campaign setting. |
| `API_RATE_LIMIT_MAX` | no | `100` | Max HTTP requests per `API_RATE_LIMIT_WINDOW` (protects the API from being hammered, e.g. by a buggy script). |
| `API_RATE_LIMIT_WINDOW` | no | `1 minute` | Window for the above, in `@fastify/rate-limit` duration syntax. |

**Sending-limit variables are not a way to push Gmail harder.** The defaults
are conservative on purpose — they're not tuned to find Gmail's actual
ceiling. Raising them on a personal Gmail account risks temporary SMTP
suspension.

---

## 11. Database migrations

Schema is defined once, in `src/db/schema.ts` (Drizzle ORM table
definitions), and compiled to SQL migration files under `drizzle/`.

```bash
# Generate a new migration after changing src/db/schema.ts
npm run db:generate

# Apply all pending migrations to DATABASE_URL
npm run db:migrate

# Inspect the schema visually (opens Drizzle Studio in your browser)
npm run db:studio
```

`db:generate` only needs to run when you change `src/db/schema.ts` — the
migration files already in `drizzle/` are committed to the repo, so a fresh
checkout only needs `db:migrate`.

Tables created:

| Table | Purpose |
|---|---|
| `contacts` | One row per HR contact, deduplicated by (lowercased) email |
| `email_templates` | Reusable subject/body templates with `{{variables}}` |
| `campaigns` | A template + a recipient filter + send settings |
| `email_jobs` | One row per (campaign, contact) pair — the actual send queue, mirrored in BullMQ |
| `email_events` | Append-only audit log of every state transition per job |
| `suppression_list` | Emails that must never be sent to, regardless of campaign |

Key constraints (see [§22](#22-security-considerations) for why each matters):

- `contacts.email` — `UNIQUE` — prevents storing the same person twice
- `email_jobs (campaign_id, contact_id)` — `UNIQUE` — prevents ever double-queuing the same recipient in the same campaign
- `suppression_list.email` — `UNIQUE`
- Foreign keys with `ON DELETE CASCADE` from `email_jobs`/`email_events` — deleting a campaign or contact cleans up its job history automatically

---

## 12. PDF import

### Why this is harder than it sounds

The source PDF exports table cells **without delimiters**. Extracted text
looks like this, glued together with zero separators between fields:

```
1Akanksha Puriakanksha.puri@sourcefuse.comAssociate Director HRSourceFuse Technologies
```

There is no character marking where the name ends and the email begins, or
where the job title ends and the company begins. `src/modules/contacts/parser.ts`
recovers each boundary with a different strategy:

1. **Record boundary** — a new record starts only when a line begins with the
   next expected serial number in sequence (not merely "starts with a digit,"
   since wrapped long emails create continuation lines that also start with
   digits).
2. **Email boundary** — anchored on `@`, then walked outward: left to where a
   valid local-part character run starts, right to a recognized TLD (with a
   fallback rule for TLDs not in the built-in list).
3. **Name vs. email local-part** — scored: the email local part usually
   restates the person's name (`akanksha.puri` for "Akanksha Puri"), so the
   split point that makes that true wins.
4. **Title vs. company** — scored against the email domain (does the company
   candidate look like it produced this domain?), plus a title vocabulary the
   parser *learns* from the rows the domain has already confirmed with high
   confidence, before applying that vocabulary to the harder, ambiguous rows.

Every parsed contact gets a `confidence` field: `high` (company corroborated
by the domain), `medium` (partial match), or `low` (title/company recovered
but not verifiable — often still correct, e.g. `anindita.ranjan@3ds.com` really
is "Dassault Systems," just not derivable from the domain string). Low-confidence
rows are **stored, not discarded** — flagged for manual review rather than
silently dropped or guessed further.

### Running an import

```bash
# 1. Preview first — parses and prints a report, writes nothing to the DB
npm run import:contacts -- ./data/hr-contacts.pdf --dry

# 2. Actually import
npm run import:contacts -- ./data/hr-contacts.pdf
```

Or via the API (multipart upload):

```bash
curl -X POST localhost:3000/contacts/import \
  -F "file=@./data/hr-contacts.pdf"
```

### The import report

Both the CLI and the API return the same report shape:

```
total records found:     1842
successfully parsed:     1842
invalid emails:          0     (rejected — malformed, role account, or missing name; never stored)
duplicate emails:        0     (same address appearing more than once within the file)
incomplete records:      0     (stored, but missing title or company — nothing invented)
skipped records:         0     (lines that couldn't be parsed into a record at all)
```

**Data rules enforced by the parser and import service:**

- Nothing is ever invented. If a title or company can't be reliably extracted,
  the field is stored empty/null and the record is flagged `incomplete` — never
  guessed into something plausible-looking.
- Whitespace is normalized (collapsed, trimmed) on every text field.
- Email addresses are lowercased before storage and before the uniqueness check.
- Deduplication is by (lowercased) email — first occurrence in the file wins;
  later occurrences are counted, not silently overwritten.
- Names, titles, and companies are preserved exactly as extracted — no case
  changes, no reformatting beyond whitespace normalization.

Re-running the same file is **safe and idempotent** — matching is by email, so
a second import updates existing rows (name/title/company refreshed) instead
of creating duplicates.

Review low-confidence contacts before sending to them:

```bash
curl 'localhost:3000/contacts?confidence=low&limit=50'
```

---

## 13. Creating a template

A template has a `subject`, a `bodyText` (plain-text, required), and an
optional `bodyHtml`. Both are rendered independently — a real SMTP send
includes both parts (multipart), with `bodyText` as the fallback for clients
that don't render HTML.

Supported variables — see [`{{firstName}}` vs `{{name}}`](#variable-reference) below.

```bash
curl -X POST localhost:3000/templates \
  -H 'content-type: application/json' \
  -d '{
    "name": "swe-outreach-v1",
    "subject": "Software Engineering Opportunity — {{company}}",
    "bodyText": "Dear {{firstName}},\n\nI am a 4th-year B.Tech student at NIT Agartala, currently looking for Software Engineering, Backend, and Full Stack opportunities.\n\nI came across {{company}} and wanted to reach out regarding any relevant opportunities for students or upcoming graduates.\n\nI would be grateful if you could consider my profile for suitable openings.\n\nBest regards,\nRaghuraj Pratap Singh\nB.Tech, NIT Agartala",
    "bodyHtml": "<p>Dear {{firstName}},</p><p>I am a 4th-year B.Tech student at NIT Agartala, currently looking for Software Engineering, Backend, and Full Stack opportunities.</p><p>I came across <strong>{{company}}</strong> and wanted to reach out regarding any relevant opportunities for students or upcoming graduates.</p><p>Best regards,<br>Raghuraj Pratap Singh</p>"
  }'
```

Template validation happens **at creation time**, not at send time: an unknown
`{{variable}}` is rejected immediately with a 400, before it ever reaches a
real contact.

```bash
# Rejected immediately:
curl -X POST localhost:3000/templates \
  -H 'content-type: application/json' \
  -d '{"name":"bad","subject":"{{salary}}","bodyText":"x"}'
# → {"error":"Unknown template variable(s): {{salary}}. Supported: {{name}}, {{firstName}}, {{fullName}}, {{title}}, {{company}}, {{email}}"}
```

### Variable reference

| Variable | Resolves to | Notes |
|---|---|---|
| `{{firstName}}` | First name only | Use this in greetings. Falls back to full name, then to the email's local part, if the first name is somehow empty — this is the one variable that degrades gracefully instead of failing the send. |
| `{{name}}` | Full name | Same as `{{fullName}}`. **Not** the right choice for `Dear {{name}},` — that would render `Dear Akanksha Puri,` in a first-name greeting. |
| `{{fullName}}` | Full name | Explicit alias of `{{name}}`, for templates that prefer the self-documenting spelling. |
| `{{title}}` | Job title | Empty value **fails the render** (throws) rather than sending a broken sentence like "at your ." — no plausible fallback exists for a missing title. |
| `{{company}}` | Company name | Same fail-loud behavior as `{{title}}`. |
| `{{email}}` | The contact's own email | Rarely used in body copy; available for signature-style templates. |

List all variables and their meaning via:

```bash
curl localhost:3000/templates/variables
```

Manage templates:

```bash
curl localhost:3000/templates                        # list
curl localhost:3000/templates/1                       # get one
curl -X PATCH localhost:3000/templates/1 -d '{...}'    # update (re-validates)
curl -X DELETE localhost:3000/templates/1              # delete
```

---

## 14. Creating a campaign

A campaign pairs a template with a **recipient filter** and send settings.
**Creating a campaign never sends anything** — it only ever produces a
`draft`. Sending requires the separate, explicit launch call in [§16](#16-launching-a-campaign).

```bash
curl -X POST localhost:3000/campaigns \
  -H 'content-type: application/json' \
  -d '{
    "name": "swe-outreach-batch-1",
    "templateId": 1,
    "contactFilter": {
      "confidence": "high",
      "limit": 50
    },
    "dryRun": true,
    "ratePerMinute": 20,
    "dailyCap": 400
  }'
```

`contactFilter` fields (all optional, combine with AND):

| Field | Meaning |
|---|---|
| `company` | Substring match against `contacts.company` (case-insensitive) |
| `confidence` | `high` / `medium` / `low` — restrict to contacts whose parsed data hit this confidence tier |
| `contactIds` | Explicit list of contact IDs — bypasses the filter entirely |
| `limit` | Cap the number of recipients materialized |

Only contacts with `status: 'active'` and **not** on the suppression list are
ever selected, regardless of filter — this is not something a filter can
override.

`dryRun` defaults to `true` on every new campaign. You must set it to `false`
explicitly (and also have `DRY_RUN=false` in `.env` — see [§10](#10-environment-variables))
before a launch actually reaches SMTP.

---

## 15. Previewing an email

Two preview paths — use either before ever launching a campaign.

**Preview a template directly, against any contact:**

```bash
curl -X POST localhost:3000/templates/1/preview \
  -H 'content-type: application/json' \
  -d '{"contactId": 1}'
```

**Preview a specific campaign's rendered email for one contact** (uses that
campaign's actual template — useful once a campaign exists):

```bash
curl -X POST localhost:3000/campaigns/1/preview \
  -H 'content-type: application/json' \
  -d '{"contactId": 1}'
```

Response:

```json
{
  "to": "akanksha.puri@sourcefuse.com",
  "subject": "Software Engineering Opportunity — SourceFuse Technologies",
  "text": "Dear Akanksha,\n\nI am a 4th-year B.Tech student at NIT Agartala...",
  "html": "<p>Dear Akanksha,</p><p>I am a 4th-year B.Tech student..."
}
```

**Preview several matching contacts at once** (first N matches for the
campaign's filter, without materializing any job):

```bash
curl 'localhost:3000/campaigns/1/preview?limit=5'
```

None of these calls write to `email_jobs`, queue anything in Redis, or touch
SMTP — they are pure renders.

---

## 16. Launching a campaign

```bash
curl -X POST localhost:3000/campaigns/1/start
```

This is the **only** call that sends mail (or, if `dryRun` is on, simulates
sending). What it does:

1. Selects recipients matching the campaign's filter (active, not suppressed).
2. Renders the template against each recipient and **freezes** that rendered
   content into a new `email_jobs` row — later template edits cannot change
   already-launched mail.
3. Enqueues one BullMQ job per recipient.
4. Marks the campaign `running`.

**Safe to call more than once on the same campaign.** The `UNIQUE(campaign_id,
contact_id)` database constraint means a repeat launch only picks up
recipients that weren't already materialized (e.g. contacts added to the
matching set since the first launch, or jobs that failed to insert due to a
transient error) — it will never queue the same recipient twice.

Response:

```json
{
  "campaignId": 1,
  "recipients": 50,
  "queued": 50,
  "alreadyQueued": 0,
  "renderErrors": []
}
```

`renderErrors` lists any contact whose data was too incomplete to render the
template (e.g. an empty `{{company}}` with a company-referencing template) —
those contacts are skipped, not sent with broken content, and everyone else
still launches normally.

---

## 17. Pausing / resuming

```bash
curl -X POST localhost:3000/campaigns/1/pause
curl -X POST localhost:3000/campaigns/1/resume
```

**Pausing stops the campaign mid-flight, not just at the next launch.** The
worker checks the campaign's status immediately before every single send —
even a job already sitting in the BullMQ queue will be skipped (not sent, not
retried) if its campaign is paused by the time the worker picks it up.

Resuming re-enqueues anything left in `queued` status that the pause
interrupted.

---

## 18. Monitoring jobs

```bash
curl localhost:3000/campaigns/1/stats
```

```json
{
  "pending": 0,
  "queued": 12,
  "sent": 35,
  "failed": 1,
  "skipped": 2,
  "total": 50
}
```

Per-recipient status:

```bash
curl 'localhost:3000/contacts?limit=100'                    # all contacts
curl 'localhost:3000/contacts?confidence=low'                # needs review
curl 'localhost:3000/contacts?status=disabled'                # suppressed/disabled
```

Every state transition for every job is also recorded in `email_events`
(queued → sent/failed/retried/skipped/dry_run) — query it directly via
`npm run db:studio` for a full audit trail, including error messages for
failed sends.

Overall system health:

```bash
curl localhost:3000/health
# {"status":"ok","dryRun":true,"database":true,"redis":true}
```

---

## 19. Running the worker

The worker is a separate process from the API — start both.

```bash
# Terminal 1
npm run dev            # API on http://localhost:3000

# Terminal 2
npm run dev:worker     # Worker — picks up queued jobs
```

Both use `tsx watch`, so edits to source files restart the process
automatically during development.

On startup, if `DRY_RUN=false`, the worker calls `transporter.verify()` and
**refuses to start** if SMTP authentication fails — you'll never discover a
bad App Password mid-campaign, only at boot.

Production (compiled):

```bash
npm run build
npm run start           # API
npm run start:worker    # Worker, separate process/terminal/service
```

Graceful shutdown: both processes handle `SIGTERM`/`SIGINT` by finishing any
in-flight work (the worker lets a send-in-progress complete before closing)
before releasing the SMTP connection, Redis connection, and Postgres pool.

---

## 20. Running in Docker

```bash
cp .env.example .env    # fill in real SMTP_USER / SMTP_PASSWORD first
docker compose up -d postgres redis    # infra only
npm run db:migrate                      # run once, from the host, against the Dockerized DB

docker compose --profile app up -d --build    # API + worker containers
```

`docker-compose.yml` defines four services: `postgres`, `redis`, `api`,
`worker`. The `api` and `worker` services are gated behind the `app` Compose
profile so `docker compose up -d postgres redis` (infra-only, useful when
running the app itself via `npm run dev` on the host) doesn't also build and
start them.

**Credentials are never inlined into `docker-compose.yml`.** Both `api` and
`worker` services load configuration via `env_file: .env` — the compose file
itself contains no SMTP host, user, or password. `.env` is gitignored;
`docker-compose.yml` is safe to commit as-is.

```bash
docker compose logs -f worker     # tail worker logs
docker compose logs -f api        # tail API logs
docker compose down               # stop everything (data volumes persist)
docker compose down -v            # stop and delete data volumes
```

---

## 21. Troubleshooting

**`SMTP verification failed` on worker startup**
`SMTP_PASSWORD` is not a valid Gmail App Password — re-check [§9](#9-gmail-app-password-setup).
Most common cause: pasting your regular Google account password instead of an
App Password, or generating the App Password before enabling 2-Step
Verification (the button won't even appear until 2FA is on).

**`Invalid environment configuration` at boot**
The printed list names exactly which variable is missing or malformed — the
process exits before doing anything else, on purpose, so a bad config never
silently limps along. Compare `.env` against `.env.example`.

**Emails aren't sending, but no error appears**
Check `DRY_RUN` — if it's `true` (the default), every send is intercepted
before SMTP and logged as `DRY RUN — not sent` in the worker log, with the job
marked `skipped` in the database. Confirm via:
```bash
curl localhost:3000/health   # look for "dryRun": false
```

**Campaign stats show `queued` not decreasing**
The worker process isn't running, or it's paused on `DRY_RUN`/campaign-paused.
Check `npm run dev:worker` is actually up and check its log output directly.

**`campaign already completed` when trying to launch**
A campaign moves to `completed` automatically once every job reaches a
terminal state (sent/failed/skipped). Create a new campaign for further sends
to the same or a different contact filter — campaigns aren't reusable.

**Duplicate emails after re-running an import**
This shouldn't happen — `contacts.email` is `UNIQUE`, and import matches by
email (updates existing rows). If you see actual duplicate sends, check
`email_jobs` for the specific `campaign_id`/`contact_id` pair; the unique
constraint there is what prevents a contact from being queued twice within one
campaign — it does not prevent the same contact being queued in two
*different* campaigns, which is expected (that's two different campaigns
choosing to email the same person).

**PDF import reports a high `skippedRecords` count**
Run with `--dry` first and inspect the console output — it prints unparsed
lines directly. This usually means a genuinely different PDF export format
than the one `parser.ts` was built against; the parser's boundary-detection
logic (see [§12](#12-pdf-import)) assumes a specific glued-field structure.

**Redis connection errors**
Confirm Redis is actually reachable at `REDIS_URL`:
```bash
redis-cli -u "$REDIS_URL" ping
```

**PostgreSQL connection errors**
Confirm Postgres is reachable and migrations have been applied:
```bash
psql "$DATABASE_URL" -c "select 1;"
npm run db:migrate
```

---

## 22. Security considerations

This is a **single-operator local tool** — it does not implement
authentication, and that's intentional: it's designed to run on your own
machine (or a private container) with no public exposure, not as a
multi-tenant hosted service. Do not put this API behind a public IP without
adding your own access control in front of it (a reverse proxy with basic
auth, a VPN, or an SSH tunnel are all reasonable choices) — as shipped, anyone
who can reach the port can launch campaigns.

What **is** enforced, regardless of the above:

- **Credentials never touch logs.** `SMTP_PASSWORD` is redacted at the Pino
  logger level (not just at call sites — so any future code path that happens
  to log a config object or a raw SMTP error is covered automatically), never
  echoed on validation failure, and never returned by any API response.
- **`SMTP_PASSWORD` must be a Gmail App Password**, not your real account
  password — scoped, independently revocable, and useless for anything beyond
  SMTP if leaked.
- **`.env` is gitignored**; only `.env.example` (with empty secret values) is
  committed. Docker Compose loads secrets via `env_file`, never inlined into
  the compose file itself.
- <a name="duplicate-send-protection"></a>**Duplicate-send protection is a
  database constraint, not an application check.** `UNIQUE(campaign_id,
  contact_id)` on `email_jobs` means even a concurrent double-launch or a
  worker retry racing against itself cannot result in the same person getting
  the same campaign's email twice — the database rejects the second insert
  outright.
- **Suppression is re-checked at send time, not just at enqueue time.** A
  contact added to the suppression list *after* a campaign has already queued
  their job will still not be mailed — the worker checks suppression status
  immediately before every SMTP call.
- **All SQL goes through Drizzle's parameterized query builder.** There is no
  raw string concatenation into SQL anywhere in the codebase — the small
  number of `sql\`...\`` template usages (for `ANY()`, `COUNT()`, and atomic
  increments) use Drizzle's tagged-template parameterization, not string
  interpolation, so they carry the same injection protection as any other
  query.
- **All external input is validated with Zod** before it reaches business
  logic — malformed request bodies/params are rejected with a 400 and a
  specific field-level error, never silently coerced or passed through.
- **Unknown template variables are rejected at template-creation time.**
  There is no template execution engine (no `eval`, no `Function()`
  construction, no expression language) — rendering is literal
  `{{variable}}` substring substitution against a fixed whitelist of known
  keys, so there is no template-injection surface for an attacker to exploit
  even if template content came from an untrusted source.
- **HTML email bodies are escaped per-substituted-value**, not the whole
  template — a contact's name, title, or company containing `<`, `>`, `&`, or
  quotes cannot break out of the surrounding HTML markup you wrote. This
  matters because contact data originates from a third-party PDF, not from
  you.
- **Retrying a hard bounce is refused.** A permanent SMTP failure (5xx,
  invalid recipient) is never retried — repeatedly hitting a nonexistent
  mailbox damages sender reputation and would eventually get the sending
  account rate-limited or flagged.
- **`DRY_RUN=true` is the default** in `.env.example` — a fresh checkout
  cannot accidentally send real mail without a deliberate, explicit change.

If you later do decide to expose this beyond your own machine, the minimum
additions worth making are: a reverse proxy with an access-control layer in
front of the whole API, and TLS termination (the API itself speaks plain HTTP).

---

## Example: a real contact becoming a personalized email

Input, from the PDF (glued, no delimiters — see [§12](#12-pdf-import)):

```
1Akanksha Puriakanksha.puri@sourcefuse.comAssociate Director HRSourceFuse Technologies
```

Parsed and stored:

```json
{
  "serialNumber": 1,
  "name": "Akanksha Puri",
  "firstName": "Akanksha",
  "email": "akanksha.puri@sourcefuse.com",
  "title": "Associate Director HR",
  "company": "SourceFuse Technologies",
  "confidence": "high"
}
```

Template:

```
Subject: Software Engineering Opportunity — {{company}}

Dear {{firstName}},

I am a 4th-year B.Tech student at NIT Agartala, currently looking for
Software Engineering, Backend, and Full Stack opportunities.

I came across {{company}} and wanted to reach out regarding any relevant
opportunities for students or upcoming graduates.

Best regards,
Raghuraj Pratap Singh
```

Rendered (this exact output, verified against the running system):

```
Subject: Software Engineering Opportunity — SourceFuse Technologies

Dear Akanksha,

I am a 4th-year B.Tech student at NIT Agartala, currently looking for
Software Engineering, Backend, and Full Stack opportunities.

I came across SourceFuse Technologies and wanted to reach out regarding any
relevant opportunities for students or upcoming graduates.

Best regards,
Raghuraj Pratap Singh
```

Note what did **not** happen: the greeting is `Dear Akanksha,` — not `Dear
{{name}},` (unrendered) and not `Dear Akanksha Puri,` (full name where a first
name belongs).

---

## Quick command reference

```bash
# Setup
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run db:migrate

# Import contacts
npm run import:contacts -- ./data/hr-contacts.pdf --dry
npm run import:contacts -- ./data/hr-contacts.pdf

# Run
npm run dev            # API
npm run dev:worker      # Worker (separate terminal)

# Everyday operations (see full examples in §13–18)
curl -X POST localhost:3000/templates -d '{...}'
curl -X POST localhost:3000/campaigns -d '{...}'
curl -X POST localhost:3000/campaigns/1/preview -d '{"contactId":1}'
curl -X POST localhost:3000/campaigns/1/start
curl -X POST localhost:3000/campaigns/1/pause
curl -X POST localhost:3000/campaigns/1/resume
curl localhost:3000/campaigns/1/stats

# Build & typecheck
npm run typecheck
npm run build
```
