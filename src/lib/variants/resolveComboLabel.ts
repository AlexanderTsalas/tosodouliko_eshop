import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve one or more attribute_combo objects (jsonb { slug: value_id })
 * into display labels. Used by snapshot writers (orders, supply orders,
 * cart contention payloads, wishlist notifications) to freeze a
 * human-readable string at write time.
 *
 * Single batched query for all combos. Returns "Strawberry · 30ml" style.
 */
export async function resolveComboLabels(
  client: SupabaseClient,
  combos: Array<Record<string, string> | null | undefined>
): Promise<Array<string | null>> {
  // Collect every value UUID referenced.
  const valueIds = new Set<string>();
  for (const combo of combos) {
    if (!combo) continue;
    for (const id of Object.values(combo)) valueIds.add(id);
  }
  if (valueIds.size === 0) return combos.map(() => null);

  const { data: rows } = await client
    .from("attribute_values")
    .select("id, value")
    .in("id", Array.from(valueIds));
  const byId = new Map(
    ((rows ?? []) as Array<{ id: string; value: string }>).map((r) => [r.id, r.value])
  );

  return combos.map((combo) => {
    if (!combo) return null;
    const labels = Object.values(combo)
      .map((id) => byId.get(id))
      .filter((s): s is string => typeof s === "string");
    if (labels.length === 0) return null;
    return labels.join(" · ");
  });
}

/** Convenience for a single combo. */
export async function resolveComboLabel(
  client: SupabaseClient,
  combo: Record<string, string> | null | undefined
): Promise<string | null> {
  const [label] = await resolveComboLabels(client, [combo]);
  return label;
}
