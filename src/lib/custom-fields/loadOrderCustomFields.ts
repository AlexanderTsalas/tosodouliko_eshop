"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CustomField,
  CustomFieldEditPolicy,
  Translations,
} from "@/types/custom-fields";

/**
 * Helper for the order admin panel: returns the custom-field rows for
 * all line items of an order, joined with their field metadata so the
 * UI can render labels + decide which rows are editable.
 *
 * Indexed by order_item_id for direct rendering inside the existing
 * line-item list.
 */
export interface OrderItemCustomFieldEntry {
  id: string;
  order_item_id: string;
  field_id: string;
  unit_index: number | null;
  value: unknown;
  contributed_price: number;
  /** Field metadata used by the renderer. */
  field: {
    key: string;
    label_translations: Translations;
    data_type: CustomField["data_type"];
    edit_policy: CustomFieldEditPolicy;
    validation: Record<string, unknown>;
    /** Per-value labels (for boolean / dropdown / multi_select) so the
     *  admin sees "Δωρεάν αποστολή" instead of the raw "true". */
    values: Array<{
      id: string;
      value: unknown;
      label_translations: Translations;
    }>;
  };
}

export async function loadOrderCustomFields(
  order_id: string
): Promise<Record<string, OrderItemCustomFieldEntry[]>> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("order_item_custom_fields")
    .select(
      "id, order_item_id, field_id, unit_index, value, contributed_price, " +
        "custom_fields(key, label_translations, data_type, edit_policy, validation), " +
        "order_items!inner(order_id)"
    )
    .eq("order_items.order_id", order_id)
    .order("unit_index", { ascending: true });

  type Row = {
    id: string;
    order_item_id: string;
    field_id: string;
    unit_index: number | null;
    value: unknown;
    contributed_price: number | string;
    custom_fields:
      | {
          key: string;
          label_translations: Translations;
          data_type: CustomField["data_type"];
          edit_policy: CustomFieldEditPolicy;
          validation: Record<string, unknown>;
        }
      | Array<{
          key: string;
          label_translations: Translations;
          data_type: CustomField["data_type"];
          edit_policy: CustomFieldEditPolicy;
          validation: Record<string, unknown>;
        }>
      | null;
  };
  const entries = (rows ?? []) as unknown as Row[];

  if (entries.length === 0) return {};

  // Fetch per-value labels for the fields actually present in this
  // order — needed to translate "true"/"option_key" into customer
  // labels.
  const fieldIds = Array.from(new Set(entries.map((e) => e.field_id)));
  const { data: valueRows } = await admin
    .from("custom_field_values")
    .select("field_id, id, value, label_translations")
    .in("field_id", fieldIds);

  type ValueRow = {
    field_id: string;
    id: string;
    value: unknown;
    label_translations: Translations;
  };
  const valuesByField: Record<string, ValueRow[]> = {};
  for (const v of (valueRows ?? []) as ValueRow[]) {
    (valuesByField[v.field_id] ??= []).push(v);
  }

  const out: Record<string, OrderItemCustomFieldEntry[]> = {};
  for (const e of entries) {
    const fieldMeta = Array.isArray(e.custom_fields)
      ? e.custom_fields[0]
      : e.custom_fields;
    if (!fieldMeta) continue;
    const fieldValues = valuesByField[e.field_id] ?? [];
    (out[e.order_item_id] ??= []).push({
      id: e.id,
      order_item_id: e.order_item_id,
      field_id: e.field_id,
      unit_index: e.unit_index,
      value: e.value,
      contributed_price: Number(e.contributed_price) || 0,
      field: {
        key: fieldMeta.key,
        label_translations: fieldMeta.label_translations,
        data_type: fieldMeta.data_type,
        edit_policy: fieldMeta.edit_policy,
        validation: fieldMeta.validation,
        values: fieldValues.map((v) => ({
          id: v.id,
          value: v.value,
          label_translations: v.label_translations,
        })),
      },
    });
  }
  return out;
}
