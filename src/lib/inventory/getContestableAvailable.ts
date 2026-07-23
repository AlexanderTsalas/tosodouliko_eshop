import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns the *contestable* availability for a batch of variant_ids in
 * ONE Postgres round-trip via `contestable_available_for_many` (Phase 2
 * of the data-layer remediation). Replaces a per-variant RPC loop that
 * ALSO wrote (inline cleanup), so this is by far the largest single
 * round-trip reduction on storefront product detail pages.
 *
 *     contestable = quantity_available + quantity_soft_held + quantity_priority_held
 *
 * Different from `getEffectiveAvailableForVariants`, which is per-viewer
 * and answers "can THIS viewer acquire X right now." Contestable is the
 * storefront-wide "is this still in play?" — only `quantity_reserved`
 * (paid orders) is excluded.
 *
 * Used by:
 *   - the product page CTA (Add-to-cart vs Notify-me)
 *   - catalog filters that decide whether an OOS variant is visible
 *   - sitemap and direct URL gating
 *
 * Trade vs the legacy per-row function: the batch variant does NOT run
 * opportunistic session cleanup. The reaper cron handles that. Net:
 * product detail pages stop racing the cleanup writes on every render.
 */
export async function getContestableAvailableForVariants(
  variantIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (variantIds.length === 0) return result;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "contestable_available_for_many" as never,
    { p_variant_ids: variantIds } as never
  );

  if (error || !data) {
    // Defensive fallback: return 0 for every requested variant.
    for (const id of variantIds) result.set(id, 0);
    if (error) {
      console.error(
        `[getContestableAvailableForVariants] batch RPC failed: ${error.message}`
      );
    }
    return result;
  }

  for (const row of data as Array<{ variant_id: string; qty: number }>) {
    result.set(row.variant_id, Number(row.qty ?? 0));
  }
  // Fill in zeros for any variant_id the RPC didn't return (no
  // inventory row — should be rare).
  for (const id of variantIds) {
    if (!result.has(id)) result.set(id, 0);
  }
  return result;
}
