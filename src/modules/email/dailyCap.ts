import type IORedis from 'ioredis';

/**
 * Daily send cap, tracked in Redis.
 *
 * Gmail's consumer limit is roughly 500 recipients/day; exceeding it gets the
 * account temporarily locked for SMTP. The counter is incremented only after a
 * genuine send, and expires automatically two days out so no cleanup job is
 * needed.
 */
export function dailyKey(date = new Date()): string {
  return `email:sent:${date.toISOString().slice(0, 10)}`;
}

export async function getSentToday(redis: IORedis): Promise<number> {
  const v = await redis.get(dailyKey());
  return v ? Number(v) : 0;
}

export async function incrementSentToday(redis: IORedis): Promise<number> {
  const key = dailyKey();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60 * 60 * 48);
  return count;
}

/** Milliseconds until the next UTC midnight, used to re-delay capped jobs. */
export function msUntilTomorrow(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 60_000);
}
