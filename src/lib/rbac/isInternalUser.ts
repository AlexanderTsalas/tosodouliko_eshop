import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side coarse identity check. Calls the `public.is_internal_user()` RPC
 * (SECURITY DEFINER under the current auth.uid()), which returns true only when
 * the caller's user_profiles.account_type = 'internal'.
 *
 * This is the coarse boundary that complements the granular permission checks:
 * `has_permission` already requires internal, but this exposes the identity
 * bit directly for gating the whole /admin segment and for UI that should key
 * off "is this a back-office user" rather than a specific capability.
 *
 * Wrapped in React.cache() to dedupe within a request, and returns false on
 * any error — fail-closed, matching checkPermission.
 */
export const isInternalUser = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_internal_user");

  if (error) {
    console.error("[rbac] isInternalUser failed:", error.message);
    return false;
  }

  return Boolean(data);
});
