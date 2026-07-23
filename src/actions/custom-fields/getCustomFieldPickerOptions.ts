"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import type { CustomField, CustomFieldGroup } from "@/types/custom-fields";

/**
 * Lightweight field + group lists (id + display label) for the bulk
 * custom-field assignment picker in the panel's bulk-edit mode.
 */
export async function getCustomFieldPickerOptions(): Promise<{
  fields: { id: string; label: string; dataType: string }[];
  groups: { id: string; label: string }[];
}> {
  await requirePermission("manage:products");
  const admin = createAdminClient();
  const [fieldsRes, groupsRes] = await Promise.all([
    admin
      .from("custom_fields")
      .select("*")
      .eq("visible", true)
      .order("created_at", { ascending: false }),
    admin
      .from("custom_field_groups")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false }),
  ]);
  const fields = ((fieldsRes.data ?? []) as CustomField[]).map((f) => ({
    id: f.id,
    label: f.label_translations?.el ?? f.key,
    dataType: f.data_type,
  }));
  const groups = ((groupsRes.data ?? []) as CustomFieldGroup[]).map((g) => ({
    id: g.id,
    label: g.name_translations?.el ?? "(ομάδα)",
  }));
  return { fields, groups };
}
