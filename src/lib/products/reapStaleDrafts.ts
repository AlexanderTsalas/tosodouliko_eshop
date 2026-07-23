import { createAdminClient } from "@/lib/supabase/admin";

/** Default abandonment window — drafts untouched this long are reaped. */
export const STALE_DRAFT_TTL_HOURS = 48;
/** Max rows deleted per tick; the backlog drains over subsequent runs. */
const REAP_BATCH = 500;

/**
 * Delete abandoned draft products — rows with `is_draft = true` whose
 * `updated_at` is older than the TTL. SAFE by construction: the predicate
 * keys on `is_draft`, so intentionally-inactive *finished* products
 * (is_draft = false) are never touched. `product_images`, variants, etc.
 * are removed by their `ON DELETE CASCADE` FKs; the orphaned storage blobs
 * are then swept by the existing media reaper.
 *
 * `updated_at` advances on every panel autosave, so an actively-edited
 * draft keeps resetting its clock and is never reaped mid-work.
 */
export async function reapStaleDrafts(
  ttlHours: number = STALE_DRAFT_TTL_HOURS
): Promise<{ deleted: number }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000).toISOString();

  // Select the batch first so we can return an exact count + scope the
  // delete to a known id set.
  const { data, error: selErr } = await admin
    .from("products")
    .select("id")
    .eq("is_draft", true)
    .lt("updated_at", cutoff)
    .limit(REAP_BATCH);
  if (selErr) throw new Error(selErr.message);

  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return { deleted: 0 };

  const { error: delErr } = await admin
    .from("products")
    .delete()
    .in("id", ids)
    .eq("is_draft", true); // defensive: never delete a non-draft
  if (delErr) throw new Error(delErr.message);

  return { deleted: ids.length };
}
