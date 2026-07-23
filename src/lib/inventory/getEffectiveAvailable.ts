import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns the effective availability for a batch of variant_ids in ONE
 * Postgres round-trip via `effective_available_for_many` (Phase 2 of
 * the data-layer remediation). Replaces a per-variant RPC loop.
 *
 * Viewer-awareness: when a viewer id is supplied (or resolvable from
 * the current auth session), the SQL function adds back the viewer's
 * own soft/priority/reserved contributions so multi-tab self-contention
 * doesn't fake "sold out" for the customer who is in fact the one
 * holding the inventory.
 *
 * Trade vs the legacy per-row function: the batch variant does NOT
 * run opportunistic session cleanup inline. The reaper cron handles
 * cleanup in the background. Net: storefront pages render faster and
 * stop racing the cleanup writes.
 *
 * Callers in an auth-bearing request context (server components,
 * server actions) get viewer-awareness via the implicit auth resolution.
 * Callers in a non-auth context (cron, admin tooling) get the global
 * figure when viewerId is null.
 */
export async function getEffectiveAvailableForVariants(
  variantIds: string[],
  options: { viewerId?: string | null } = {}
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (variantIds.length === 0) return result;

  let viewerId = options.viewerId ?? null;
  if (viewerId === null) {
    // Best-effort: pull the current request's auth user if any.
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      viewerId = data.user?.id ?? null;
    } catch {
      viewerId = null;
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "effective_available_for_many" as never,
    {
      p_variant_ids: variantIds,
      p_viewer_id: viewerId,
    } as never
  );

  if (error || !data) {
    // Defensive fallback: return 0 for every requested variant so the
    // UI gracefully degrades to "show as OOS" rather than crashing.
    for (const id of variantIds) result.set(id, 0);
    if (error) {
      console.error(
        `[getEffectiveAvailableForVariants] batch RPC failed: ${error.message}`
      );
    }
    return result;
  }

  for (const row of data as Array<{ variant_id: string; qty: number }>) {
    result.set(row.variant_id, Number(row.qty ?? 0));
  }
  // Fill in zeros for any variant_id the RPC didn't return (no
  // inventory_items row exists — same semantics as the per-row
  // function's `COALESCE(v_base, 0)`).
  for (const id of variantIds) {
    if (!result.has(id)) result.set(id, 0);
  }
  return result;
}

/**
 * Convenience wrapper for the single-variant case (cart pre-checks etc.).
 */
export async function getEffectiveAvailable(
  variantId: string,
  options: { viewerId?: string | null } = {}
): Promise<number> {
  const map = await getEffectiveAvailableForVariants([variantId], options);
  return map.get(variantId) ?? 0;
}
