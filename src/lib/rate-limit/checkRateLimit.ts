/**
 * Rate limiter — sliding window per (key, action).
 *
 * Primary impl: Upstash Ratelimit (serverless Redis). Drives the
 * security-critical auth/discount/checkout-code limiters that need to
 * survive multi-instance deploys + process restarts. Configured via env:
 *
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Fallback: in-memory Map. Used in local dev when the Upstash env vars
 * aren't set so `next dev` works out of the box without provisioning
 * Redis. The fallback emits a one-time warning so a deploy that forgets
 * to set the env vars doesn't silently degrade auth defenses.
 *
 * Public API (allowed / remaining / resetAt) is identical across both
 * backends — the ~10 callers in src/actions/** don't change.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

let warnedOnce = false;
function warnFallback(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set; " +
      "falling back to in-memory rate limiter. Multi-instance deployments " +
      "will NOT enforce limits correctly under this fallback."
  );
}

let redisSingleton: Redis | null = null;
function getRedis(): Redis | null {
  if (!HAS_UPSTASH) {
    warnFallback();
    return null;
  }
  if (!redisSingleton) {
    redisSingleton = new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! });
  }
  return redisSingleton;
}

// Memoize Ratelimit instances keyed by (limit, windowMs) — callers pass
// varying limits/windows, but a given (limit, window) combo is reused
// many times. Avoids per-call allocation.
const limiterCache = new Map<string, Ratelimit>();
function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const k = `${limit}:${windowMs}`;
  let lim = limiterCache.get(k);
  if (!lim) {
    lim = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      analytics: false,
      prefix: "rl",
    });
    limiterCache.set(k, lim);
  }
  return lim;
}

export interface RateLimitInput {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  input: RateLimitInput
): Promise<RateLimitResult> {
  const lim = getLimiter(input.limit, input.windowMs);
  if (lim) {
    const r = await lim.limit(input.key);
    return {
      allowed: r.success,
      remaining: r.remaining,
      resetAt: r.reset,
    };
  }
  return inMemoryCheck(input);
}

/**
 * Tracks the number of DISTINCT values seen for a given key within a
 * sliding window. Returns `allowed: false` when adding the supplied
 * value would push the distinct count above `limit`.
 *
 * Defends against credential stuffing — one attacker, one IP, rotating
 * through many usernames. The per-(IP, email) limiter doesn't catch this
 * because each (ip, email) gets its own quota; this one keys on IP only
 * and counts distinct emails attempted.
 *
 * Repeated attempts on the SAME value don't increment the distinct
 * count, so a legitimate user retrying their own login isn't penalized
 * here (the per-(IP, email) limit handles that case).
 *
 * Redis backing: ZSET keyed by `rl:distinct:<input.key>`, score = ts ms,
 * member = the value being tracked. ZREMRANGEBYSCORE drops expired
 * entries on every check; ZCARD gives the distinct count.
 */
interface DistinctEntry {
  value: string;
  ts: number;
}
const distinctBuckets = new Map<string, DistinctEntry[]>();

export interface DistinctRateLimitInput {
  key: string;
  value: string;
  limit: number;
  windowMs: number;
}

export async function checkDistinctRateLimit(
  input: DistinctRateLimitInput
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return inMemoryDistinctCheck(input);

  const redisKey = `rl:distinct:${input.key}`;
  const now = Date.now();
  const cutoff = now - input.windowMs;

  // One round-trip: drop expired entries, ask if this value already
  // exists (so legitimate retries don't get counted again), get the
  // distinct count of survivors.
  const readPipe = redis.pipeline();
  readPipe.zremrangebyscore(redisKey, 0, cutoff);
  readPipe.zscore(redisKey, input.value);
  readPipe.zcard(redisKey);
  const [, existingScore, currentCountRaw] = (await readPipe.exec()) as [
    number,
    number | null,
    number,
  ];
  const currentCount = currentCountRaw ?? 0;

  const isNewValue = existingScore === null;
  const projected = currentCount + (isNewValue ? 1 : 0);

  if (projected > input.limit) {
    // For resetAt, fetch the oldest surviving entry's timestamp.
    // withScores returns a flat [member, score, member, score, ...] array.
    const oldest = (await redis.zrange(redisKey, 0, 0, {
      withScores: true,
    })) as Array<string | number>;
    const oldestScore =
      oldest.length >= 2 ? Number(oldest[1]) : now;
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldestScore + input.windowMs,
    };
  }

  // Allowed. If this value is new, record it and refresh TTL atomically.
  if (isNewValue) {
    const writePipe = redis.pipeline();
    writePipe.zadd(redisKey, { score: now, member: input.value });
    writePipe.pexpire(redisKey, input.windowMs);
    await writePipe.exec();
  }

  return {
    allowed: true,
    remaining: input.limit - projected,
    resetAt: now + input.windowMs,
  };
}

// ─── In-memory fallback ─────────────────────────────────────────────
// Used only when Upstash env vars are absent. Same behavior as the
// pre-Upstash implementation; works correctly in single-process dev.
// Per-process state — multi-instance deploys + process restarts will
// drop or fragment this state, which is exactly why we prefer Upstash.

const buckets = new Map<string, number[]>();

function inMemoryCheck(input: RateLimitInput): RateLimitResult {
  const now = Date.now();
  const cutoff = now - input.windowMs;
  const arr = buckets.get(input.key) ?? [];
  const recent = arr.filter((t) => t > cutoff);
  if (recent.length >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: recent[0] + input.windowMs,
    };
  }
  recent.push(now);
  buckets.set(input.key, recent);
  return {
    allowed: true,
    remaining: input.limit - recent.length,
    resetAt: now + input.windowMs,
  };
}

function inMemoryDistinctCheck(
  input: DistinctRateLimitInput
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - input.windowMs;
  const arr = distinctBuckets.get(input.key) ?? [];
  const recent = arr.filter((e) => e.ts > cutoff);
  const existing = new Set(recent.map((e) => e.value));
  const isNewValue = !existing.has(input.value);
  const projected = existing.size + (isNewValue ? 1 : 0);
  if (projected > input.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: (recent[0]?.ts ?? now) + input.windowMs,
    };
  }
  if (isNewValue) recent.push({ value: input.value, ts: now });
  distinctBuckets.set(input.key, recent);
  return {
    allowed: true,
    remaining: input.limit - projected,
    resetAt: now + input.windowMs,
  };
}
