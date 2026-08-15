import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../plugins/logger.js';

let transporter: Transporter | null = null;

/**
 * Single shared transporter with a pooled connection.
 *
 * Gmail penalizes rapid connect/disconnect cycles, so reusing one authenticated
 * connection is both faster and safer for account standing. `maxConnections: 1`
 * matches the worker's concurrency of 1 — the send path is deliberately serial.
 */
export function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
    pool: true,
    maxConnections: env.MAX_CONCURRENT_EMAILS,
    maxMessages: 100,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    // A single send (data phase included) may not exceed the configured job
    // timeout — this is what actually bounds a hung SMTP conversation, rather
    // than the BullMQ lock alone.
    socketTimeout: env.EMAIL_JOB_TIMEOUT_MS,
  });

  // Logged without any credential field.
  logger.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER },
    'SMTP transport initialized',
  );

  return transporter;
}

export async function verifyTransport(): Promise<boolean> {
  try {
    await getTransporter().verify();
    logger.info('SMTP credentials verified');
    return true;
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      'SMTP verification failed — check SMTP_USER and that SMTP_PASSWORD is a Gmail App Password',
    );
    return false;
  }
}

export async function closeTransport(): Promise<void> {
  transporter?.close();
  transporter = null;
}

/**
 * Distinguishes permanent from transient failures.
 *
 * Retrying a nonexistent mailbox (5.1.1) wastes attempts and damages sender
 * reputation, so those are terminal. Rate limits and network faults are worth
 * retrying with backoff.
 */
export type FailureKind = 'permanent' | 'transient';

export function classifyFailure(err: unknown): FailureKind {
  const e = err as { responseCode?: number; code?: string; message?: string };
  const code = e.responseCode;
  const text = `${e.code ?? ''} ${e.message ?? ''}`.toLowerCase();

  if (code && code >= 500 && code < 600) {
    // 5xx is permanent in SMTP, except Gmail's rate-limit responses.
    if (text.includes('try again') || text.includes('rate') || text.includes('too many')) {
      return 'transient';
    }
    return 'permanent';
  }
  if (text.includes('invalid recipient') || text.includes('no such user')) return 'permanent';
  return 'transient';
}
