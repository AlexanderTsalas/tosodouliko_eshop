import { createClient } from "@/lib/supabase/server";
import type { ProductSpecificationView } from "@/types/product-specifications";

/**
 * Fetches a product's specs joined with attribute slug+name for rendering.
 * Sorted by display_order, then attribute name for deterministic output.
 */
export async function getProductSpecifications(
  productId: string
): Promise<ProductSpecificationView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_specifications")
    .select("id, attribute_id, value, display_order, attributes(slug, name)")
    .eq("product_id", productId)
    .order("display_order")
    .order("created_at");

  type Row = {
    id: string;
    attribute_id: string;
    value: string;
    display_order: number;
    attributes: { slug: string; name: string } | { slug: string; name: string }[] | null;
  };

  return ((data ?? []) as Row[])
    .map((r) => {
      const attr = Array.isArray(r.attributes) ? r.attributes[0] : r.attributes;
      if (!attr) return null;
      return {
        id: r.id,
        attribute_id: r.attribute_id,
        attribute_slug: attr.slug,
        attribute_name: attr.name,
        value: r.value,
        display_order: r.display_order,
      };
    })
    .filter((x): x is ProductSpecificationView => x !== null);
}
