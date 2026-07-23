import "server-only";
import { sendEmail, type SendEmailInput } from "./index";
import type { Result } from "@/types/result";
import type { SendResult } from "@/types/email";

interface BatchSenderOptions {
  /**
   * Maximum sends per minute. Defaults to 50 — well below typical
   * transactional-email provider rate limits (SendGrid: 100/s, Resend:
   * 100/s for paid, 2/s for free; SMTP varies). The dispatcher's wishlist
   * notification waves are bounded by inventory, rarely exceeding tens of
   * sends, so 50/min is comfortable for the foreseeable future.
   */
  maxPerMinute?: number;
}

interface BatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** First N error messages for diagnostics; the rest are dropped to keep logs sane. */
  sampleErrors: string[];
}

/**
 * Phase 6 — throttled batch email send.
 *
 * Spaces sends across N requests so we don't bunch them all into a single
 * second and hit provider rate limits. For waves below the per-minute
 * limit, total wall-clock duration is `count * 60s / maxPerMinute`.
 *
 * Best-effort: per-send failures are tallied but don't abort the batch.
 * Callers should treat the result as a summary, not a transaction.
 */
export async function sendBatch(
  emails: SendEmailInput[],
  options: BatchSenderOptions = {}
): Promise<BatchResult> {
  const maxPerMinute = options.maxPerMinute ?? 50;
  const delayMs = Math.ceil(60_000 / maxPerMinute);

  let succeeded = 0;
  let failed = 0;
  const sampleErrors: string[] = [];
  const errorSampleCap = 5;

  for (let i = 0; i < emails.length; i += 1) {
    const result: Result<SendResult> = await sendEmail(emails[i]);
    if (result.success) {
      succeeded += 1;
    } else {
      failed += 1;
      if (sampleErrors.length < errorSampleCap) {
        sampleErrors.push(result.error);
      }
    }
    if (i < emails.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { attempted: emails.length, succeeded, failed, sampleErrors };
}
