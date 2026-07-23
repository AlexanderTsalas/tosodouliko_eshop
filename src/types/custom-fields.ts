/**
 * Custom Fields engine — domain types.
 *
 * Mirrors the SQL schema in migration 20260611000041. Tables split into
 * three layers:
 *
 *   LIBRARY    CustomField, CustomFieldValue, CustomFieldValueSubfield,
 *              CustomFieldGroup, CustomFieldGroupMember
 *
 *   BINDINGS   CustomFieldBinding
 *
 *   ORDERS     OrderItemCustomField  (frozen snapshot per order item)
 */

// ─── Localization ────────────────────────────────────────────────────

/**
 * Locale-keyed strings stored in jsonb columns. Greek (`el`) is the
 * required locale at launch; English (`en`) and others fill in as the
 * merchant translates.
 *
 * Typed as `Record<string, string>` — TypeScript treats key access as
 * always-defined `string`. At runtime a missing locale yields
 * `undefined`, so callers should always provide a fallback when
 * displaying (e.g. `translations.el ?? field.key`). The fallback is a
 * runtime guard even though TS doesn't surface the undefined case.
 */
export type Translations = Record<string, string>;

// ─── Enums ───────────────────────────────────────────────────────────

export type CustomFieldDataType =
  | "text"
  | "number"
  | "boolean"
  | "dropdown"
  | "multi_select";

export type CustomFieldEditPolicy = "frozen" | "admin_until_dispatch";

export type CustomFieldModifierKind = "none" | "flat" | "percent";

export type CustomFieldScopeKind = "category" | "product" | "variant";

// ─── Validation configs (jsonb shape per data_type) ──────────────────

export interface TextValidation {
  maxLength?: number;
  regex?: string;
}

export interface NumberValidation {
  min?: number;
  max?: number;
  step?: number;
  integerOnly?: boolean;
}

export interface MultiSelectValidation {
  minSelections?: number;
  maxSelections?: number;
}

/** Discriminated by the parent field's data_type — read accordingly. */
export type CustomFieldValidation =
  | TextValidation
  | NumberValidation
  | MultiSelectValidation
  | Record<string, never>;

// ─── Library entities ────────────────────────────────────────────────

export interface CustomField {
  id: string;
  key: string;
  label_translations: Translations;
  data_type: CustomFieldDataType;
  required_default: boolean;
  visible: boolean;
  /** When true, the field is collected once per unit (qty > 1 → multiple
   *  values stored with distinct unit_index). When false, collected once
   *  per cart line regardless of qty. */
  per_unit: boolean;
  validation: CustomFieldValidation;
  edit_policy: CustomFieldEditPolicy;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CustomFieldValue {
  id: string;
  field_id: string;
  /** Encoded jsonb value. For boolean: true|false. For dropdown /
   *  multi_select: a string option key. */
  value: boolean | string | number;
  /** Customer-facing label per locale (relevant for dropdown / multi_select;
   *  empty for boolean — render via the Ναι/Όχι convention). */
  label_translations: Translations;
  modifier_kind: CustomFieldModifierKind;
  /** For 'flat': euros (e.g. 5.00).
   *  For 'percent': fraction of original base (0.10 = 10%). */
  modifier_amount: number;
  message_translations: Translations | null;
  sort_order: number;
  created_at: string;
}

export interface CustomFieldValueSubfield {
  id: string;
  parent_value_id: string;
  child_field_id: string;
  sort_order: number;
  created_at: string;
}

export interface CustomFieldGroup {
  id: string;
  name_translations: Translations;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CustomFieldGroupMember {
  group_id: string;
  field_id: string;
  sort_order: number;
  added_at: string;
}

// ─── Bindings ────────────────────────────────────────────────────────

/** Either field_id or group_id is set (XOR enforced by CHECK constraint). */
export interface CustomFieldBinding {
  id: string;
  field_id: string | null;
  group_id: string | null;
  scope_kind: CustomFieldScopeKind;
  scope_resource_id: string;
  active: boolean;
  /** NULL inherits the field's required_default. Boolean overrides per
   *  binding (useful for "required at variant level even though optional
   *  at category level"). */
  override_required: boolean | null;
  created_at: string;
  created_by: string | null;
}

// ─── Order persistence ───────────────────────────────────────────────

export interface OrderItemCustomField {
  id: string;
  order_item_id: string;
  field_id: string;
  /** 0..qty-1 for per_unit fields; null for per-line fields. */
  unit_index: number | null;
  /** Customer-submitted value; shape depends on the parent field's data_type. */
  value: boolean | string | number | string[];
  /** Locked-in modifier price at order time. Immune to later field-config
   *  changes (modifier_amount edits don't retroactively touch this row). */
  contributed_price: number;
  created_at: string;
}

// ─── Composite read shapes (for UI) ──────────────────────────────────

/** A library field with its per-value config loaded. Used by the field
 *  editor and the storefront resolver. */
export interface CustomFieldWithValues extends CustomField {
  values: CustomFieldValue[];
}

/** A group with its members + each member's per-value config. Used when
 *  resolving a binding that points to a group. */
export interface CustomFieldGroupWithFields extends CustomFieldGroup {
  members: Array<{
    sort_order: number;
    field: CustomFieldWithValues;
  }>;
}

/** A binding with its target loaded (either a field or a group, never
 *  both). Used by the bindings list on the library page and by the
 *  storefront resolver. */
export type ResolvedCustomFieldBinding = CustomFieldBinding &
  (
    | { field: CustomFieldWithValues; group: null }
    | { field: null; group: CustomFieldGroupWithFields }
  );
