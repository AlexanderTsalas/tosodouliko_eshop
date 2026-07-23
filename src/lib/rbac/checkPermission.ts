import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side permission check. Calls the `public.has_permission(text)` RPC
 * which runs SECURITY DEFINER under the current auth.uid().
 *
 * Wrapped in React.cache() to deduplicate within a single request — an
 * admin page may render 5-10 <RequirePermission> components that each
 * call this with the same or different permission names. After the first
 * call per permission, the rest are cache hits (zero DB round-trips).
 *
 * Returns false (rather than throwing) on any error — defensive default for
 * permission checks.
 */
export const checkPermission = cache(
  async (permissionName: string): Promise<boolean> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("has_permission", {
      perm: permissionName,
    });

    if (error) {
      console.error("[rbac] checkPermission failed:", error.message);
      return false;
    }

    return Boolean(data);
  }
);
