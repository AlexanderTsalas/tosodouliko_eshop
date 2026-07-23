import { createClient } from "@/lib/supabase/server";
import type { TrackEventInput } from "@/types/user-tracking";

/**
 * Insert a tracking event. Uses the regular server client (RLS allows INSERT
 * for both anon and authenticated users on this table).
 *
 * Contract: must never throw — tracking failures must not break the caller.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("tracking_events").insert({
      session_id: input.sessionId,
      user_id: input.userId ?? null,
      event_name: input.eventName,
      properties: input.properties ?? null,
      url: input.url ?? null,
      referrer: input.referrer ?? null,
    });
  } catch (err) {
    console.error("[tracking] trackEvent failed:", err);
  }
}
