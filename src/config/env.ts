import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is parsed once, at boot, and fails loudly. A missing SMTP
 * credential should stop the process here rather than surface as a confusing
 * auth error on the first send attempt.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  SMTP_HOST: z.string().min(1).default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().email(),
  // Gmail App Passwords are shown as "abcd efgh ijkl mnop"; strip the spaces so
  // a copy-paste from Google's UI works without silent auth failures.
  SMTP_PASSWORD: z
    .string()
    .min(1, 'SMTP_PASSWORD is required — use a Gmail App Password')
    .transform((v) => v.replace(/\s+/g, '')),

  MAIL_FROM_NAME: z.string().min(1),
  MAIL_FROM_EMAIL: z.string().email(),
  MAIL_REPLY_TO: z.string().email().optional(),

  // Conservative defaults — deliberately below what Gmail would tolerate, not
  // an attempt to find the actual ceiling.
  EMAILS_PER_MINUTE: z.coerce.number().int().positive().max(60).default(20),
  EMAIL_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  MAX_CONCURRENT_EMAILS: z.coerce.number().int().positive().max(5).default(1),
  EMAIL_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  EMAIL_DAILY_CAP: z.coerce.number().int().positive().default(400),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  DRY_RUN: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  API_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Printed without any value echo — an invalid secret must not reach stderr.
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
