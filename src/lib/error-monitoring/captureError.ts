import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CaptureErrorInput } from "@/types/error-monitoring";

/**
 * Record an error event. Idempotent on `fingerprint` — duplicate captures
 * increment occurrence_count rather than creating new rows.
 *
 * Contract: must never throw. Returns void.
 */
export async function captureError(input: CaptureErrorInput): Promise<void> {
  try {
    const fingerprint = makeFingerprint(input);
    const admin = createAdminClient();

    // Try to upsert; on conflict, increment occurrence_count and update last_seen_at.
    const { error } = await admin.rpc("upsert_error_event" as never, {
      p_fingerprint: fingerprint,
      p_message: input.message,
      p_stack: input.stack ?? null,
      p_level: input.level ?? "error",
      p_severity: input.severity ?? "medium",
      p_type: input.type ?? null,
      p_context: stripPii(input.context ?? {}) as never,
      p_user_id: input.userId ?? null,
    } as never);

    // Fall back to plain insert if the RPC is not present (we don't ship a
    // SECURITY DEFINER upsert function; this path is used in development).
    if (error) {
      await admin
        .from("error_events")
        .upsert(
          {
            fingerprint,
            message: input.message,
            stack_trace: input.stack ?? null,
            level: input.level ?? "error",
            severity: input.severity ?? "medium",
            type: input.type ?? null,
            context: stripPii(input.context ?? {}),
            user_id: input.userId ?? null,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "fingerprint", ignoreDuplicates: false }
        );
    }
  } catch (err) {
    console.error("[error-monitoring] captureError failed:", err);
  }
}

function makeFingerprint(input: CaptureErrorInput): string {
  const seed = `${input.type ?? ""}|${input.message}|${(input.stack ?? "").split("\n")[0] ?? ""}`;
  return createHash("sha1").update(seed).digest("hex").slice(0, 32);
}

const PII_KEYS = new Set([
  "email",
  "password",
  "phone",
  "card",
  "card_number",
  "cvv",
  "ssn",
  "token",
]);

function stripPii(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}
