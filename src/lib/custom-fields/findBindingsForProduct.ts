"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CustomField,
  CustomFieldValue,
  CustomFieldGroup,
  CustomFieldGroupMember,
  CustomFieldBinding,
  CustomFieldWithValues,
  CustomFieldGroupWithFields,
  ResolvedCustomFieldBinding,
  CustomFieldScopeKind,
} from "@/types/custom-fields";

/**
 * Given a product id, returns all custom-field bindings that apply to
 * it grouped by scope kind. Used by the product editor's "Πεδία
 * πελάτη" tab to show the merchant which fields/groups the customer
 * will see on this product's page.
 *
 * Categories: bindings on ANY of the product's categories.
 * Product: bindings whose scope_resource_id is exactly this product.
 * Variants: bindings whose scope_resource_id is one of this product's
 *           variants (grouped by variant for clarity).
 *
 * For each binding, the field-or-group is resolved with its full
 * config (values for fields; member fields for groups) so the tab can
 * render rich previews without further fetches.
 */
export interface ProductBindingsResult {
  /** Inherited from category-scope bindings — read-only at the product
   *  level; admin must edit them at the category. */
  fromCategory: Array<{
    category_id: string;
    category_name: string;
    binding: ResolvedCustomFieldBinding;
  }>;
  /** Bindings whose scope is exactly this product. Editable. */
  fromProduct: ResolvedCustomFieldBinding[];
  /** Bindings on individual variants of this product, indexed by
   *  variant for display. Editable per variant. */
  fromVariant: Array<{
    variant_id: string;
    variant_sku: string;
    bindings: ResolvedCustomFieldBinding[];
  }>;
}

export async function findBindingsForProduct(
  product_id: string
): Promise<ProductBindingsResult> {
  const admin = createAdminClient();

  // Pull the product's categories + variants in parallel.
  const [productCategoriesRes, variantsRes] = await Promise.all([
    admin
      .from("product_categories")
      .select("category_id, categories(id, name)")
      .eq("product_id", product_id),
    admin
      .from("product_variants")
      .select("id, sku")
      .eq("product_id", product_id)
      .eq("is_active", true)
      .order("sku"),
  ]);

  type CategoryRow = { id: string; name: string };
  type PCRow = {
    category_id: string;
    categories: CategoryRow | CategoryRow[] | null;
  };
  const categoryEntries = ((productCategoriesRes.data ?? []) as PCRow[]).map(
    (r) => {
      const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
      return {
        category_id: r.category_id,
        category_name: cat?.name ?? "(κατηγορία)",
      };
    }
  );
  const categoryIds = categoryEntries.map((e) => e.category_id);

  type VariantRow = { id: string; sku: string };
  const variantList = (variantsRes.data ?? []) as VariantRow[];
  const variantIds = variantList.map((v) => v.id);

  // Pull all bindings touching any of these scopes — one query each
  // for category and variant (so the IN clauses are tight) plus one
  // for the exact product. Skip a category/variant query when the
  // input list is empty.
  const [categoryBindingsRes, productBindingsRes, variantBindingsRes] =
    await Promise.all([
      categoryIds.length === 0
        ? Promise.resolve({ data: [] as CustomFieldBinding[] })
        : admin
            .from("custom_field_bindings")
            .select("*")
            .eq("scope_kind", "category" satisfies CustomFieldScopeKind)
            .in("scope_resource_id", categoryIds),
      admin
        .from("custom_field_bindings")
        .select("*")
        .eq("scope_kind", "product" satisfies CustomFieldScopeKind)
        .eq("scope_resource_id", product_id),
      variantIds.length === 0
        ? Promise.resolve({ data: [] as CustomFieldBinding[] })
        : admin
            .from("custom_field_bindings")
            .select("*")
            .eq("scope_kind", "variant" satisfies CustomFieldScopeKind)
            .in("scope_resource_id", variantIds),
    ]);

  const categoryBindings = (categoryBindingsRes.data ??
    []) as CustomFieldBinding[];
  const productBindings = (productBindingsRes.data ??
    []) as CustomFieldBinding[];
  const variantBindings = (variantBindingsRes.data ??
    []) as CustomFieldBinding[];
  const allBindings = [
    ...categoryBindings,
    ...productBindings,
    ...variantBindings,
  ];

  // Resolve each binding's target (field or group). Collect the field
  // and group ids referenced + bulk-fetch their composite shapes in
  // one go.
  const fieldIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const b of allBindings) {
    if (b.field_id) fieldIds.add(b.field_id);
    if (b.group_id) groupIds.add(b.group_id);
  }

  const [fieldsRes, fieldValuesRes, groupsRes, groupMembersRes] =
    await Promise.all([
      fieldIds.size === 0
        ? Promise.resolve({ data: [] as CustomField[] })
        : admin
            .from("custom_fields")
            .select("*")
            .in("id", Array.from(fieldIds)),
      fieldIds.size === 0
        ? Promise.resolve({ data: [] as CustomFieldValue[] })
        : admin
            .from("custom_field_values")
            .select("*")
            .in("field_id", Array.from(fieldIds))
            .order("sort_order"),
      groupIds.size === 0
        ? Promise.resolve({ data: [] as CustomFieldGroup[] })
        : admin
            .from("custom_field_groups")
            .select("*")
            .in("id", Array.from(groupIds)),
      groupIds.size === 0
        ? Promise.resolve({ data: [] as CustomFieldGroupMember[] })
        : admin
            .from("custom_field_group_members")
            .select("*")
            .in("group_id", Array.from(groupIds))
            .order("sort_order"),
    ]);

  // Compute the full set of fields we need (direct binding targets +
  // members of bound groups) and fetch their values if missing.
  const groupMembers = (groupMembersRes.data ?? []) as CustomFieldGroupMember[];
  const allFieldIds = new Set<string>(fieldIds);
  for (const m of groupMembers) allFieldIds.add(m.field_id);

  const additionalFieldIds = Array.from(allFieldIds).filter(
    (id) => !fieldIds.has(id)
  );
  const directFields = (fieldsRes.data ?? []) as CustomField[];
  const directFieldValues = (fieldValuesRes.data ?? []) as CustomFieldValue[];

  const [memberFieldsFetched, memberFieldValuesFetched] = await Promise.all([
    additionalFieldIds.length === 0
      ? Promise.resolve([] as CustomField[])
      : admin
          .from("custom_fields")
          .select("*")
          .in("id", additionalFieldIds)
          .then((r) => (r.data ?? []) as CustomField[]),
    additionalFieldIds.length === 0
      ? Promise.resolve([] as CustomFieldValue[])
      : admin
          .from("custom_field_values")
          .select("*")
          .in("field_id", additionalFieldIds)
          .order("sort_order")
          .then((r) => (r.data ?? []) as CustomFieldValue[]),
  ]);

  const allFields: CustomField[] = [...directFields, ...memberFieldsFetched];
  const allFieldValues: CustomFieldValue[] = [
    ...directFieldValues,
    ...memberFieldValuesFetched,
  ];

  // Compose CustomFieldWithValues.
  const valuesByField = new Map<string, CustomFieldValue[]>();
  for (const v of allFieldValues) {
    const list = valuesByField.get(v.field_id) ?? [];
    list.push(v);
    valuesByField.set(v.field_id, list);
  }
  const fieldsWithValues = new Map<string, CustomFieldWithValues>();
  for (const f of allFields) {
    fieldsWithValues.set(f.id, {
      ...f,
      values: valuesByField.get(f.id) ?? [],
    });
  }

  // Compose CustomFieldGroupWithFields.
  const membersByGroup = new Map<string, CustomFieldGroupMember[]>();
  for (const m of groupMembers) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m);
    membersByGroup.set(m.group_id, list);
  }
  const groupsWithFields = new Map<string, CustomFieldGroupWithFields>();
  for (const g of (groupsRes.data ?? []) as CustomFieldGroup[]) {
    const members = (membersByGroup.get(g.id) ?? [])
      .map((m) => {
        const field = fieldsWithValues.get(m.field_id);
        if (!field) return null;
        return { sort_order: m.sort_order, field };
      })
      .filter(
        (x): x is { sort_order: number; field: CustomFieldWithValues } =>
          x !== null
      );
    groupsWithFields.set(g.id, { ...g, members });
  }

  // Resolve each binding row → ResolvedCustomFieldBinding.
  function resolveBinding(
    b: CustomFieldBinding
  ): ResolvedCustomFieldBinding | null {
    if (b.field_id) {
      const f = fieldsWithValues.get(b.field_id);
      if (!f) return null;
      return { ...b, field: f, group: null };
    }
    if (b.group_id) {
      const g = groupsWithFields.get(b.group_id);
      if (!g) return null;
      return { ...b, field: null, group: g };
    }
    return null;
  }

  // ─── Bucket by scope kind ──────────────────────────────────────────
  const fromCategory: ProductBindingsResult["fromCategory"] = [];
  for (const b of categoryBindings) {
    const resolved = resolveBinding(b);
    if (!resolved) continue;
    const cat = categoryEntries.find(
      (e) => e.category_id === b.scope_resource_id
    );
    if (!cat) continue;
    fromCategory.push({
      category_id: cat.category_id,
      category_name: cat.category_name,
      binding: resolved,
    });
  }

  const fromProduct: ResolvedCustomFieldBinding[] = productBindings
    .map((b) => resolveBinding(b))
    .filter((x): x is ResolvedCustomFieldBinding => x !== null);

  const fromVariantMap = new Map<string, ResolvedCustomFieldBinding[]>();
  for (const b of variantBindings) {
    const resolved = resolveBinding(b);
    if (!resolved) continue;
    const list = fromVariantMap.get(b.scope_resource_id) ?? [];
    list.push(resolved);
    fromVariantMap.set(b.scope_resource_id, list);
  }
  const fromVariant: ProductBindingsResult["fromVariant"] = variantList.map(
    (v) => ({
      variant_id: v.id,
      variant_sku: v.sku,
      bindings: fromVariantMap.get(v.id) ?? [],
    })
  );

  return { fromCategory, fromProduct, fromVariant };
}
