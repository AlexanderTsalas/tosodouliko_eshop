"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import { findBindingsForProduct } from "@/lib/custom-fields/findBindingsForProduct";
import type { ProductBindingsResult } from "@/lib/custom-fields/findBindingsForProduct";
import type {
  CustomField,
  CustomFieldValue,
  CustomFieldGroup,
  CustomFieldGroupMember,
  CustomFieldWithValues,
  CustomFieldGroupWithFields,
} from "@/types/custom-fields";

/**
 * Custom-field binding data for the panel's "Πεδία" tab. Mirrors the old
 * ProductCustomFieldsTab server loader — buckets bindings by scope
 * (category-inherited / product / per-variant) and composes the field +
 * group libraries for the inline pickers. Lazy-loaded when the tab opens.
 */
export async function getProductCustomFieldsData(productId: string): Promise<{
  bindingsByScope: ProductBindingsResult;
  fieldsLibrary: CustomFieldWithValues[];
  groupsLibrary: CustomFieldGroupWithFields[];
}> {
  await requirePermission("manage:products");
  const admin = createAdminClient();

  const [
    bindings,
    fieldsRes,
    fieldValuesRes,
    groupsRes,
    groupMembersRes,
    allFieldsForGroupRes,
    allFieldValuesForGroupRes,
  ] = await Promise.all([
    findBindingsForProduct(productId),
    admin
      .from("custom_fields")
      .select("*")
      .eq("visible", true)
      .order("created_at", { ascending: false }),
    admin.from("custom_field_values").select("*").order("sort_order"),
    admin
      .from("custom_field_groups")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false }),
    admin.from("custom_field_group_members").select("*").order("sort_order"),
    admin.from("custom_fields").select("*"),
    admin.from("custom_field_values").select("*").order("sort_order"),
  ]);

  const visibleFields = (fieldsRes.data ?? []) as CustomField[];
  const allFieldValues = (fieldValuesRes.data ?? []) as CustomFieldValue[];
  const groups = (groupsRes.data ?? []) as CustomFieldGroup[];
  const groupMembers = (groupMembersRes.data ?? []) as CustomFieldGroupMember[];
  const allFields = (allFieldsForGroupRes.data ?? []) as CustomField[];
  const allFieldValuesForGroup = (allFieldValuesForGroupRes.data ??
    []) as CustomFieldValue[];

  // Compose CustomFieldWithValues for the visible-fields picker.
  const valuesByField: Record<string, CustomFieldValue[]> = {};
  for (const v of allFieldValues) {
    (valuesByField[v.field_id] ??= []).push(v);
  }
  const fieldsLibrary: CustomFieldWithValues[] = visibleFields.map((f) => ({
    ...f,
    values: valuesByField[f.id] ?? [],
  }));

  // Compose CustomFieldGroupWithFields for the groups picker.
  const valuesByFieldAll: Record<string, CustomFieldValue[]> = {};
  for (const v of allFieldValuesForGroup) {
    (valuesByFieldAll[v.field_id] ??= []).push(v);
  }
  const fieldByIdAll = new Map<string, CustomFieldWithValues>();
  for (const f of allFields) {
    fieldByIdAll.set(f.id, { ...f, values: valuesByFieldAll[f.id] ?? [] });
  }
  const membersByGroup: Record<string, CustomFieldGroupMember[]> = {};
  for (const m of groupMembers) {
    (membersByGroup[m.group_id] ??= []).push(m);
  }
  const groupsLibrary: CustomFieldGroupWithFields[] = groups.map((g) => ({
    ...g,
    members: (membersByGroup[g.id] ?? [])
      .map((m) => {
        const field = fieldByIdAll.get(m.field_id);
        if (!field) return null;
        return { sort_order: m.sort_order, field };
      })
      .filter(
        (x): x is { sort_order: number; field: CustomFieldWithValues } =>
          x !== null
      ),
  }));

  return { bindingsByScope: bindings, fieldsLibrary, groupsLibrary };
}
