import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve `show_when_oos` per variant via the variant → product → global
 * cascade. Batched in one round trip (variants + their parent product) plus
 * one tiny read of the singleton storefront_settings row.
 *
 * The cascade matches the SQL `resolve_show_when_oos(uuid)` function — this
 * helper just performs the same COALESCE walk on JS side so callers can
 * filter without an N+1 of RPC calls.
 */
export async function resolveShowWhenOosForVariants(
  client: SupabaseClient,
  variantIds: string[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (variantIds.length === 0) return result;

  const [{ data: rows }, { data: settings }] = await Promise.all([
    client
      .from("product_variants")
      .select("id, show_when_oos, products(show_when_oos)")
      .in("id", variantIds),
    client
      .from("storefront_settings")
      .select("show_when_oos_default")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const globalDefault = Boolean(
    (settings as { show_when_oos_default: boolean } | null)?.show_when_oos_default ?? false
  );

  type Row = {
    id: string;
    show_when_oos: boolean | null;
    products:
      | { show_when_oos: boolean | null }
      | { show_when_oos: boolean | null }[]
      | null;
  };
  for (const row of (rows ?? []) as Row[]) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const resolved =
      row.show_when_oos ?? product?.show_when_oos ?? globalDefault;
    result.set(row.id, Boolean(resolved));
  }

  return result;
}

/** Convenience for a single variant. */
export async function resolveShowWhenOos(
  client: SupabaseClient,
  variantId: string
): Promise<boolean> {
  const map = await resolveShowWhenOosForVariants(client, [variantId]);
  return map.get(variantId) ?? false;
}
