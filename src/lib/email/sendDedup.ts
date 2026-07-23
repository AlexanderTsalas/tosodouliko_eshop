import "server-only";

/**
 * Send-deduplication for transactional email.
 *
 * Prevents the same (recipient, template) pair from receiving identical
 * emails twice in a short window. Defends against:
 *   - Double-fire from a webhook delivered twice (Stripe at-least-once
 *     semantics) before idempotency keys are wired everywhere.
 *   - Form double-submit before the disabled-button state engages.
 *   - Server action retries on transient errors.
 *
 * Behavior:
 *   - First send for a (to, templateId) pair within the window: allowed,
 *     timestamp recorded.
 *   - Subsequent sends for the same pair within the window: silently
 *     suppressed (caller sees ok() with a dev-style message id).
 *
 * Same in-memory caveat as the rate limiter — replace with Redis when
 * going multi-instance. Window is intentionally short (5 min) to avoid
 * blocking legitimate retries (e.g., customer requesting a fresh
 * password-reset link 10 minutes after the first).
 */
const DEDUP_WINDOW_MS = 5 * 60_000;
const recentSends = new Map<string, number>();

/**
 * Returns true if this (to, templateId) pair was recently sent — caller
 * should skip sending. Returns false (and records the timestamp) if this
 * is a new pair within the window.
 *
 * `templateId` is required for dedup to work — if absent, no dedup applies
 * and every send proceeds (preserves existing untemplated email paths).
 */
export function shouldSuppressDuplicate(
  to: string,
  templateId: string | undefined
): boolean {
  if (!templateId) return false;
  const key = `${to.toLowerCase()}:${templateId}`;
  const now = Date.now();
  const last = recentSends.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    return true;
  }
  recentSends.set(key, now);

  // Opportunistic GC: every ~1000 inserts, prune entries older than the
  // window. Keeps the Map from growing unboundedly on long-lived processes.
  if (recentSends.size > 1000) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, t] of recentSends) {
      if (t < cutoff) recentSends.delete(k);
    }
  }
  return false;
}
