import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TAGS } from "@/lib/cache-tags";
import type { DeliveryMethodValue } from "@/config/storefront";

/**
 * Row shape returned by listActiveCustomDeliveryMethods — a subset of
 * custom_delivery_methods with just the fields the customer-facing
 * checkout needs.
 */
export interface ActiveCustomDeliveryMethod {
  slug: string;
  display_name: string;
  description: string | null;
  base_method: DeliveryMethodValue;
  /** When set, this custom method only surfaces alongside the named carrier. */
  carrier_slug: string | null;
  display_order: number;
}

/**
 * Returns active custom_delivery_methods, ordered by display_order. Used
 * by the checkout to surface admin-defined relabel options
 * ("Παράδοση με Van", "Express bike", etc.) alongside the built-in
 * methods.
 *
 * Cached cross-request under the `couriers` tag (shared with the carrier
 * list — admin carrier and custom-method mutations both bust it).
 */
const listActiveCustomDeliveryMethodsInner = async (): Promise<
  ActiveCustomDeliveryMethod[]
> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("custom_delivery_methods")
    .select(
      "slug, display_name, description, base_method, carrier_slug, display_order"
    )
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) {
    console.error(
      "[checkout] listActiveCustomDeliveryMethods failed:",
      error.message
    );
    return [];
  }
  return (data ?? []) as ActiveCustomDeliveryMethod[];
};

export const listActiveCustomDeliveryMethods = unstable_cache(
  listActiveCustomDeliveryMethodsInner,
  ["active-custom-delivery-methods"],
  { revalidate: 86400, tags: [CACHE_TAGS.COURIERS] }
);
