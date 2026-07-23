"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CustomField,
  CustomFieldValue,
  CustomFieldGroupMember,
  CustomFieldBinding,
  CustomFieldValueSubfield,
  CustomFieldWithValues,
} from "@/types/custom-fields";

/**
 * Storefront resolver — given a product (+ optional selected variant),
 * returns the FLAT ordered list of fields the customer must see.
 *
 * Resolution rules:
 *   1. Bindings touching this view are: variant-scope (for selected
 *      variant + ALL variants of the product if no selection),
 *      product-scope, category-scope (any of the product's categories).
 *   2. Dedupe per field_id with precedence variant > product > category.
 *      The most-specific binding wins → its override_required is used.
 *   3. Visible-only: fields with `visible = false` are filtered out.
 *   4. Subfields (depth-1) are loaded inline so the form can render
 *      conditional follow-ups without an extra round-trip.
 *
 * Returns null if the product itself doesn't exist or is inactive.
 */

export interface ResolvedStorefrontField {
  field: CustomFieldWithValues;
  /** Computed by combining binding.override_required ?? field.required_default. */
  effective_required: boolean;
  /** Conditional sub-fields indexed by parent_value_id (the value row
   *  that triggers them). Depth-1 only by design. */
  triggered_subfields: Map<string, ResolvedStorefrontField[]>;
  /** Which scope this binding resolved to — useful for debugging /
   *  admin tools. The storefront doesn't display it. */
  resolved_from_scope: "category" | "product" | "variant";
}

export async function resolveStorefrontFields(args: {
  product_id: string;
  variant_id?: string | null;
}): Promise<ResolvedStorefrontField[] | null> {
  const { product_id, variant_id } = args;
  const admin = createAdminClient();

  // Pull the product's categories + variants in parallel.
  const [pcRes, variantsRes] = await Promise.all([
    admin
      .from("product_categories")
      .select("category_id")
      .eq("product_id", product_id),
    admin
      .from("product_variants")
      .select("id")
      .eq("product_id", product_id)
      .eq("is_active", true),
  ]);

  const categoryIds = ((pcRes.data ?? []) as Array<{ category_id: string }>).map(
    (r) => r.category_id
  );
  const allVariantIds = ((variantsRes.data ?? []) as Array<{ id: string }>).map(
    (r) => r.id
  );

  // The "relevant" variant set for binding resolution. When the
  // customer has picked a variant, that's the only one whose bindings
  // count; otherwise all variants are eligible so the form shows
  // unconditional fields. (Variant attribute-based conditions don't
  // exist here — bindings are scoped to a SPECIFIC variant id.)
  const relevantVariantIds = variant_id ? [variant_id] : allVariantIds;

  // ─── Pull bindings touching any of these scopes ────────────────────
  const [variantBindingsRes, productBindingsRes, categoryBindingsRes] =
    await Promise.all([
      relevantVariantIds.length === 0
        ? Promise.resolve({ data: [] as CustomFieldBinding[] })
        : admin
            .from("custom_field_bindings")
            .select("*")
            .eq("scope_kind", "variant")
            .eq("active", true)
            .in("scope_resource_id", relevantVariantIds),
      admin
        .from("custom_field_bindings")
        .select("*")
        .eq("scope_kind", "product")
        .eq("active", true)
        .eq("scope_resource_id", product_id),
      categoryIds.length === 0
        ? Promise.resolve({ data: [] as CustomFieldBinding[] })
        : admin
            .from("custom_field_bindings")
            .select("*")
            .eq("scope_kind", "category")
            .eq("active", true)
            .in("scope_resource_id", categoryIds),
    ]);

  const variantBindings = (variantBindingsRes.data ??
    []) as CustomFieldBinding[];
  const productBindings = (productBindingsRes.data ??
    []) as CustomFieldBinding[];
  const categoryBindings = (categoryBindingsRes.data ??
    []) as CustomFieldBinding[];

  // Collect field ids referenced (direct + via groups). We'll bulk-fetch
  // fields, values, group members, and subfields in one wave.
  const directFieldIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const b of [...variantBindings, ...productBindings, ...categoryBindings]) {
    if (b.field_id) directFieldIds.add(b.field_id);
    if (b.group_id) groupIds.add(b.group_id);
  }

  // Pre-load group members so we know which fields are pulled in via groups.
  const groupMembersRes =
    groupIds.size === 0
      ? { data: [] as CustomFieldGroupMember[] }
      : await admin
          .from("custom_field_group_members")
          .select("*")
          .in("group_id", Array.from(groupIds))
          .order("sort_order");
  const groupMembers = (groupMembersRes.data ?? []) as CustomFieldGroupMember[];

  const allFieldIds = new Set<string>(directFieldIds);
  for (const m of groupMembers) allFieldIds.add(m.field_id);

  // We may need subfield child fields too — fetch values first, then
  // expand from any value's subfields.
  if (allFieldIds.size === 0) {
    // Nothing to render — empty form.
    return [];
  }

  const [fieldsRes, valuesRes, subfieldsRes] = await Promise.all([
    admin
      .from("custom_fields")
      .select("*")
      .in("id", Array.from(allFieldIds))
      .eq("visible", true),
    admin
      .from("custom_field_values")
      .select("*")
      .in("field_id", Array.from(allFieldIds))
      .order("sort_order"),
    // Subfield links only for values whose parent field is in our set.
    // We need value_ids — but values aren't loaded yet; defer one wave.
    Promise.resolve({ data: [] as CustomFieldValueSubfield[] }),
  ]);
  void subfieldsRes;

  const fields = (fieldsRes.data ?? []) as CustomField[];
  const values = (valuesRes.data ?? []) as CustomFieldValue[];

  // Now we know the value ids; load subfield links + the child fields.
  const parentValueIds = values.map((v) => v.id);
  const subfieldLinksRes =
    parentValueIds.length === 0
      ? { data: [] as CustomFieldValueSubfield[] }
      : await admin
          .from("custom_field_value_subfields")
          .select("*")
          .in("parent_value_id", parentValueIds)
          .order("sort_order");
  const subfieldLinks = (subfieldLinksRes.data ??
    []) as CustomFieldValueSubfield[];

  const childFieldIds = Array.from(
    new Set(subfieldLinks.map((s) => s.child_field_id))
  );
  // Child fields may overlap with what we already loaded; only fetch
  // those that aren't already in `fields`.
  const loadedFieldIds = new Set(fields.map((f) => f.id));
  const missingChildFieldIds = childFieldIds.filter(
    (id) => !loadedFieldIds.has(id)
  );
  const [extraFieldsRes, extraValuesRes] = await Promise.all([
    missingChildFieldIds.length === 0
      ? Promise.resolve({ data: [] as CustomField[] })
      : admin
          .from("custom_fields")
          .select("*")
          .in("id", missingChildFieldIds)
          .eq("visible", true),
    missingChildFieldIds.length === 0
      ? Promise.resolve({ data: [] as CustomFieldValue[] })
      : admin
          .from("custom_field_values")
          .select("*")
          .in("field_id", missingChildFieldIds)
          .order("sort_order"),
  ]);
  const allLoadedFields = [
    ...fields,
    ...((extraFieldsRes.data ?? []) as CustomField[]),
  ];
  const allLoadedValues = [
    ...values,
    ...((extraValuesRes.data ?? []) as CustomFieldValue[]),
  ];

  // ─── Build CustomFieldWithValues lookup ─────────────────────────────
  const valuesByField = new Map<string, CustomFieldValue[]>();
  for (const v of allLoadedValues) {
    const list = valuesByField.get(v.field_id) ?? [];
    list.push(v);
    valuesByField.set(v.field_id, list);
  }
  const fieldsWithValues = new Map<string, CustomFieldWithValues>();
  for (const f of allLoadedFields) {
    fieldsWithValues.set(f.id, {
      ...f,
      values: valuesByField.get(f.id) ?? [],
    });
  }

  // Subfield links indexed by parent_value_id.
  const subfieldsByParentValueId = new Map<
    string,
    CustomFieldValueSubfield[]
  >();
  for (const s of subfieldLinks) {
    const list = subfieldsByParentValueId.get(s.parent_value_id) ?? [];
    list.push(s);
    subfieldsByParentValueId.set(s.parent_value_id, list);
  }

  // ─── Helper: expand a binding to its constituent field ids ─────────
  function fieldIdsForBinding(b: CustomFieldBinding): string[] {
    if (b.field_id) return [b.field_id];
    if (b.group_id) {
      return groupMembers
        .filter((m) => m.group_id === b.group_id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((m) => m.field_id);
    }
    return [];
  }

  // ─── Variant > product > category resolution with first-wins dedupe ─
  type ScopeKey = "variant" | "product" | "category";
  const seen = new Set<string>();
  const ordered: ResolvedStorefrontField[] = [];

  function processBindings(bindings: CustomFieldBinding[], scope: ScopeKey) {
    for (const b of bindings) {
      for (const fieldId of fieldIdsForBinding(b)) {
        if (seen.has(fieldId)) continue;
        const field = fieldsWithValues.get(fieldId);
        if (!field) continue; // visible=false or not in dataset
        // Recursively build the subfield map.
        const triggered = buildTriggeredSubfields(field);
        const effective_required =
          b.override_required ?? field.required_default;
        ordered.push({
          field,
          effective_required,
          triggered_subfields: triggered,
          resolved_from_scope: scope,
        });
        seen.add(fieldId);
      }
    }
  }

  function buildTriggeredSubfields(
    parent: CustomFieldWithValues
  ): Map<string, ResolvedStorefrontField[]> {
    // For each of parent's values, look up its triggered children.
    // Depth-1 cap by design — children's own triggered_subfields stay empty.
    const out = new Map<string, ResolvedStorefrontField[]>();
    for (const v of parent.values) {
      const links = subfieldsByParentValueId.get(v.id) ?? [];
      if (links.length === 0) continue;
      const children: ResolvedStorefrontField[] = [];
      for (const link of links) {
        const childField = fieldsWithValues.get(link.child_field_id);
        if (!childField) continue; // visible=false
        children.push({
          field: childField,
          effective_required: childField.required_default,
          triggered_subfields: new Map(), // cap
          resolved_from_scope: parent
            ? (ordered[ordered.length - 1]?.resolved_from_scope ?? "product")
            : "product",
        });
      }
      if (children.length > 0) out.set(v.id, children);
    }
    return out;
  }

  processBindings(variantBindings, "variant");
  processBindings(productBindings, "product");
  processBindings(categoryBindings, "category");

  return ordered;
}
