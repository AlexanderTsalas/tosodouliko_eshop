import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TAGS } from "@/lib/cache-tags";
import type { DeliveryMethodValue } from "@/config/storefront";
import type { CarrierSlug } from "@/config/carrier-slugs";

/**
 * Row shape returned by listActiveCarriers — a subset of delivery_carriers
 * with just the fields the customer-facing checkout needs. Internal admin
 * pages should read the full row directly.
 */
export interface DeliveryCarrier {
  slug: CarrierSlug;
  display_name: string;
  supported_delivery_methods: DeliveryMethodValue[];
  display_order: number;
  is_custom: boolean;
  tracking_url_template: string | null;
}

/**
 * Returns delivery_carriers rows where is_active=true, ordered by
 * display_order. The full set is admin-managed and identical for every
 * visitor — cached cross-request under the `couriers` tag. Admin carrier
 * mutations call `updateTag("couriers")` to bust the cache instantly.
 *
 * Why admin client: data is universal (no per-user RLS variance). Using
 * the admin client keeps the cached payload safe from accidental
 * request-scoped state leaking into the cache key.
 *
 * Returns an empty array when:
 *   - no carriers are active (merchant hasn't toggled any visible)
 *   - the database is unreachable / returns an error (logged; not thrown)
 *
 * Callers MUST treat empty arrays gracefully — at checkout this means
 * hiding all carrier-dependent delivery methods rather than throwing.
 */
const listActiveCarriersInner = async (): Promise<DeliveryCarrier[]> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("delivery_carriers")
    .select(
      "slug, display_name, supported_delivery_methods, display_order, is_custom, tracking_url_template"
    )
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) {
    console.error("[courier] listActiveCarriers failed:", error.message);
    return [];
  }
  return (data ?? []) as DeliveryCarrier[];
};

export const listActiveCarriers = unstable_cache(
  listActiveCarriersInner,
  ["active-carriers"],
  { revalidate: 86400, tags: [CACHE_TAGS.COURIERS] }
);
