import type IORedis from 'ioredis';
import { env } from '../../config/env.js';

/**
 * Runtime send-mode override, stored in Redis so it can be flipped from the
 * API without editing `.env` or restarting a process.
 *
 * `env.DRY_RUN` remains the boot-time DEFAULT and the ultimate backstop: a
 * fresh deploy, or a Redis flush, always comes back up in dry-run. This
 * override only ever narrows that default toward "safer" implicitly — going
 * live requires an explicit, freshly-set key that expires on its own, so a
 * forgotten "live" flag from a week-old test can't silently stay armed.
 */
const SEND_MODE_KEY = 'email:send-mode';
const LIVE_TTL_SECONDS = 60 * 60 * 6; // auto-reverts to dry-run after 6h if left on

export type SendMode = 'dry_run' | 'live';

export async function getEffectiveDryRun(redis: IORedis): Promise<boolean> {
  const override = await redis.get(SEND_MODE_KEY);
  if (override === 'live') return false;
  if (override === 'dry_run') return true;
  // No override set — fall back to the boot-time env default.
  return env.DRY_RUN;
}

export async function getSendModeStatus(redis: IORedis): Promise<{
  effectiveDryRun: boolean;
  override: SendMode | null;
  envDefault: boolean;
  liveExpiresInSeconds: number | null;
}> {
  const [override, ttl] = await Promise.all([
    redis.get(SEND_MODE_KEY),
    redis.ttl(SEND_MODE_KEY),
  ]);
  const normalizedOverride: SendMode | null =
    override === 'live' || override === 'dry_run' ? override : null;

  return {
    effectiveDryRun: normalizedOverride === 'live' ? false : normalizedOverride === 'dry_run' ? true : env.DRY_RUN,
    override: normalizedOverride,
    envDefault: env.DRY_RUN,
    liveExpiresInSeconds: normalizedOverride === 'live' && ttl > 0 ? ttl : null,
  };
}

export async function setDryRunOverride(redis: IORedis): Promise<void> {
  // No expiry needed going back to safe — there's no harm in staying dry.
  await redis.set(SEND_MODE_KEY, 'dry_run');
}

export async function setLiveOverride(redis: IORedis): Promise<void> {
  if (env.SMTP_PASSWORD.length === 0) {
    throw new Error('cannot go live: SMTP_PASSWORD is not configured');
  }
  await redis.set(SEND_MODE_KEY, 'live', 'EX', LIVE_TTL_SECONDS);
}

export async function clearSendModeOverride(redis: IORedis): Promise<void> {
  await redis.del(SEND_MODE_KEY);
}
