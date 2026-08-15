import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Redaction is configured at the logger level rather than at call sites: any
 * future code that logs a config object or a Nodemailer error containing auth
 * details is covered automatically. Missing one call site would leak the App
 * Password into log storage permanently.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'SMTP_PASSWORD',
      'smtpPassword',
      'password',
      'pass',
      'auth.pass',
      'auth.password',
      '*.password',
      '*.pass',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
