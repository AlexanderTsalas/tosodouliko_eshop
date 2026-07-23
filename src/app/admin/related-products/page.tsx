import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/common/AdminPageHeader";
import RelatedProductsBench from "@/components/admin/related-products/RelatedProductsBench";
import type {
  RelatedProductsAssociation,
  RelatedProductsFilterGroup,
  RelatedProductsFilterCondition,
  RelatedProductsManualPick,
  RelatedProductsAssociationFull,
  RelatedProductsFilterGroupWithConditions,
} from "@/types/related-products";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Προτεινόμενα προϊόντα — Admin" };
export const dynamic = "force-dynamic";

/**
 * Related Products workshop — Phase 9a (read-only).
 *
 * Single column of association cards with the same workshop visual
 * vocabulary as offers / custom-fields benches. CRUD wiring lands in
 * 9b; filter conditions in 9c.
 */
export default async function AdminRelatedProductsPage() {
  await requirePermission("manage:products");
  const admin = createAdminClient();

  const [
    associationsRes,
    groupsRes,
    conditionsRes,
    picksRes,
    categoriesRes,
    productsRes,
    variantsRes,
    attributesRes,
    attributeValuesRes,
  ] = await Promise.all([
    admin
      .from("related_products_associations")
      .select("*")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("related_products_filter_groups")
      .select("*")
      .order("sort_order"),
    admin
      .from("related_products_filter_conditions")
      .select("*")
      .order("sort_order"),
    admin
      .from("related_products_manual_picks")
      .select("*")
      .order("sort_order"),
    // Scope/attribute lookups for the filter condition popovers.
    admin
      .from("categories")
      .select("id, name")
      .eq("active", true)
      .order("display_order"),
    admin
      .from("products")
      .select("id, name")
      .eq("active", true)
      .order("name"),
    admin
      .from("product_variants")
      .select("id, sku, product_id, products(name)")
      .eq("is_active", true)
      .order("sku"),
    admin.from("attributes").select("id, name, slug").order("name"),
    admin
      .from("attribute_values")
      .select("id, attribute_id, value")
      .order("display_order"),
  ]);

  const associations = (associationsRes.data ??
    []) as RelatedProductsAssociation[];
  const groups = (groupsRes.data ?? []) as RelatedProductsFilterGroup[];
  const conditions = (conditionsRes.data ??
    []) as RelatedProductsFilterCondition[];
  const picks = (picksRes.data ?? []) as RelatedProductsManualPick[];

  // ─── Join into composite shapes ──────────────────────────────────
  const conditionsByGroup: Record<string, RelatedProductsFilterCondition[]> =
    {};
  for (const c of conditions) {
    (conditionsByGroup[c.filter_group_id] ??= []).push(c);
  }

  const groupsByAssociation: Record<
    string,
    RelatedProductsFilterGroupWithConditions[]
  > = {};
  for (const g of groups) {
    const withConditions: RelatedProductsFilterGroupWithConditions = {
      ...g,
      conditions: conditionsByGroup[g.id] ?? [],
    };
    (groupsByAssociation[g.association_id] ??= []).push(withConditions);
  }

  const picksByAssociation: Record<string, RelatedProductsManualPick[]> = {};
  for (const p of picks) {
    (picksByAssociation[p.association_id] ??= []).push(p);
  }

  const fullAssociations: RelatedProductsAssociationFull[] = associations.map(
    (a) => {
      const allGroups = groupsByAssociation[a.id] ?? [];
      return {
        ...a,
        source_groups: allGroups.filter((g) => g.side === "source"),
        target_groups: allGroups.filter((g) => g.side === "target"),
        manual_picks: picksByAssociation[a.id] ?? [],
      };
    }
  );

  return (
    <>
      <AdminPageHeader
        title="Προτεινόμενα προϊόντα"
        subtitle={
          <span className="max-w-2xl block">
            Φτιάξτε συσχετίσεις που εμφανίζουν προτεινόμενα προϊόντα στις
            σελίδες προϊόντων με βάση κατηγορίες, χαρακτηριστικά ή
            συγκεκριμένες επιλογές. Κάθε συσχέτιση έχει δικό της τίτλο
            καρουζέλ και κανόνες ταιριάσματος.
          </span>
        }
      />
      <RelatedProductsBench
        associations={fullAssociations}
        categories={
          (categoriesRes.data ?? []) as Array<{ id: string; name: string }>
        }
        products={
          (productsRes.data ?? []) as Array<{ id: string; name: string }>
        }
        variants={(
          (variantsRes.data ?? []) as Array<{
            id: string;
            sku: string;
            product_id: string;
            products: { name: string } | { name: string }[] | null;
          }>
        ).map((v) => ({
          id: v.id,
          sku: v.sku,
          product_id: v.product_id,
          product_name:
            (Array.isArray(v.products) ? v.products[0] : v.products)?.name ??
            "(unknown)",
        }))}
        attributes={
          (attributesRes.data ?? []) as Array<{
            id: string;
            name: string;
            slug: string;
          }>
        }
        attributeValues={
          (attributeValuesRes.data ?? []) as Array<{
            id: string;
            attribute_id: string;
            value: string;
          }>
        }
      />
    </>
  );
}
