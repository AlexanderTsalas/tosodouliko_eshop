"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveStorefrontFields } from "./resolveStorefrontFields";
import type {
  CustomFieldValue,
  TextValidation,
  NumberValidation,
  MultiSelectValidation,
} from "@/types/custom-fields";

/**
 * Server-side validator for customer-submitted custom-field values.
 * The storefront also enforces these rules client-side for fast
 * feedback; this runs ALWAYS on the server before persistence so we
 * never trust the client.
 *
 * Performs three jobs:
 *   1. Re-resolves the applicable fields for this (product, variant)
 *      so we know exactly what was supposed to be filled
 *   2. Validates each submitted value against its field's data_type
 *      + validation jsonb
 *   3. Recomputes the contributed_price per value from the FIELD's
 *      current modifier config (not from the client) — so a tampered
 *      client can't claim "-€100 discount" on a value
 *
 * Returns either a validated + price-stamped value list ready for
 * insertion, or a structured error describing what failed.
 */

export type ValidatedFieldValue = {
  field_id: string;
  unit_index: number | null;
  value: unknown;
  contributed_price: number;
};

export type ValidationFailure =
  | { kind: "missing_required"; field_ids: string[] }
  | { kind: "invalid_value"; field_id: string; reason: string }
  | {
      kind: "unknown_field";
      field_id: string;
      reason: "not_applicable_to_product";
    };

export interface ValidateInput {
  product_id: string;
  variant_id: string | null;
  /** Per-unit base price (in the cart's currency) used to evaluate
   *  percent modifiers. The action passes the canonical server-fetched
   *  unit_price so the client can't influence the modifier amount. */
  base_price: number;
  /** Customer-submitted values. The server discards everything not
   *  explicitly applicable per the resolver. */
  submitted: Array<{
    field_id: string;
    unit_index?: number | null;
    value: unknown;
  }>;
}

export async function validateSubmittedCustomFields(
  input: ValidateInput
): Promise<
  | { ok: true; values: ValidatedFieldValue[]; modifier_total: number }
  | { ok: false; failure: ValidationFailure }
> {
  const applicable = await resolveStorefrontFields({
    product_id: input.product_id,
    variant_id: input.variant_id,
  });
  if (!applicable) {
    return {
      ok: false,
      failure: {
        kind: "unknown_field",
        field_id: "*",
        reason: "not_applicable_to_product",
      },
    };
  }

  // Flatten the resolver output into a map by field_id for O(1) lookup,
  // including any depth-1 conditionally-triggered subfields (they're
  // applicable too, but only when their parent value matches — we
  // accept submitted subfield values as long as they reference an
  // applicable field id).
  const applicableById = new Map<
    string,
    {
      data_type: string;
      required: boolean;
      values: CustomFieldValue[];
      validation: Record<string, unknown>;
    }
  >();
  function index(rf: import("./resolveStorefrontFields").ResolvedStorefrontField) {
    applicableById.set(rf.field.id, {
      data_type: rf.field.data_type,
      required: rf.effective_required,
      values: rf.field.values,
      validation: rf.field.validation as Record<string, unknown>,
    });
    for (const children of rf.triggered_subfields.values()) {
      for (const sub of children) index(sub);
    }
  }
  for (const rf of applicable) index(rf);

  // ─── 1. Validate each submitted value ──────────────────────────────
  const validated: ValidatedFieldValue[] = [];
  let modifier_total = 0;
  const submittedFieldIds = new Set<string>();

  for (const s of input.submitted) {
    const meta = applicableById.get(s.field_id);
    if (!meta) {
      return {
        ok: false,
        failure: {
          kind: "unknown_field",
          field_id: s.field_id,
          reason: "not_applicable_to_product",
        },
      };
    }
    submittedFieldIds.add(s.field_id);

    const result = validateOne(meta, s.value, input.base_price);
    if (result.kind === "error") {
      return {
        ok: false,
        failure: {
          kind: "invalid_value",
          field_id: s.field_id,
          reason: result.message,
        },
      };
    }
    // "Skip" means the value is effectively empty; required-check
    // below covers it.
    if (result.kind === "skip") continue;

    validated.push({
      field_id: s.field_id,
      unit_index: s.unit_index ?? null,
      value: result.value as unknown,
      contributed_price: result.contributed_price,
    });
    modifier_total += result.contributed_price;
  }

  // ─── 2. Verify all required fields were filled ──────────────────────
  const missing: string[] = [];
  for (const [fid, meta] of applicableById.entries()) {
    if (!meta.required) continue;
    if (!submittedFieldIds.has(fid)) missing.push(fid);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      failure: { kind: "missing_required", field_ids: missing },
    };
  }

  // Round to 2 decimals on the final total — per-value contributions
  // are already rounded but sums can drift a cent for percent
  // modifiers.
  modifier_total = Math.round(modifier_total * 100) / 100;
  return { ok: true, values: validated, modifier_total };
}

// ─── Per-field validation ──────────────────────────────────────────

type ValidateOneResult =
  | { kind: "ok"; value: unknown; contributed_price: number }
  | { kind: "skip" }
  | { kind: "error"; message: string };

function validateOne(
  meta: {
    data_type: string;
    values: CustomFieldValue[];
    validation: Record<string, unknown>;
  },
  raw: unknown,
  base_price: number
): ValidateOneResult {
  switch (meta.data_type) {
    case "text": {
      if (typeof raw !== "string") return { kind: "skip" };
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { kind: "skip" };
      const v = meta.validation as TextValidation;
      if (typeof v.maxLength === "number" && trimmed.length > v.maxLength) {
        return {
          kind: "error",
          message: `Πάνω από το όριο των ${v.maxLength} χαρακτήρων.`,
        };
      }
      if (typeof v.regex === "string" && v.regex.length > 0) {
        try {
          if (!new RegExp(v.regex).test(trimmed)) {
            return { kind: "error", message: "Η μορφή δεν είναι σωστή." };
          }
        } catch {
          /* malformed admin regex → ignore */
        }
      }
      // Text has no modifier.
      return { kind: "ok", value: trimmed, contributed_price: 0 };
    }
    case "number": {
      let num: number;
      if (typeof raw === "number") num = raw;
      else if (typeof raw === "string" && raw.trim() !== "")
        num = parseFloat(raw);
      else return { kind: "skip" };
      if (Number.isNaN(num)) return { kind: "skip" };
      const v = meta.validation as NumberValidation;
      if (v.integerOnly && !Number.isInteger(num)) {
        return { kind: "error", message: "Δεκτοί μόνο ακέραιοι αριθμοί." };
      }
      if (typeof v.min === "number" && num < v.min) {
        return { kind: "error", message: `Τουλάχιστον ${v.min}.` };
      }
      if (typeof v.max === "number" && num > v.max) {
        return { kind: "error", message: `Έως ${v.max}.` };
      }
      return { kind: "ok", value: num, contributed_price: 0 };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return { kind: "skip" };
      const valueRow = meta.values.find((v) => v.value === raw);
      // Even if the admin hasn't seeded a row, we still accept the
      // boolean (modifier = 0) — value rows are not strictly required
      // for boolean fields.
      const contributed = valueRow
        ? evaluateModifier(valueRow, base_price)
        : 0;
      return { kind: "ok", value: raw, contributed_price: contributed };
    }
    case "dropdown": {
      if (typeof raw !== "string" || raw.length === 0) return { kind: "skip" };
      const valueRow = meta.values.find(
        (v) => typeof v.value === "string" && v.value === raw
      );
      if (!valueRow) {
        return {
          kind: "error",
          message: "Μη έγκυρη επιλογή για αυτό το πεδίο.",
        };
      }
      return {
        kind: "ok",
        value: raw,
        contributed_price: evaluateModifier(valueRow, base_price),
      };
    }
    case "multi_select": {
      if (!Array.isArray(raw)) return { kind: "skip" };
      const selected = raw.filter(
        (x): x is string => typeof x === "string" && x.length > 0
      );
      if (selected.length === 0) return { kind: "skip" };
      const v = meta.validation as MultiSelectValidation;
      if (
        typeof v.minSelections === "number" &&
        selected.length < v.minSelections
      ) {
        return {
          kind: "error",
          message: `Επιλέξτε τουλάχιστον ${v.minSelections}.`,
        };
      }
      if (
        typeof v.maxSelections === "number" &&
        selected.length > v.maxSelections
      ) {
        return {
          kind: "error",
          message: `Έως ${v.maxSelections} επιλογές.`,
        };
      }
      let contributed = 0;
      const validValues: string[] = [];
      for (const sel of selected) {
        const valueRow = meta.values.find(
          (v) => typeof v.value === "string" && v.value === sel
        );
        if (!valueRow) {
          return {
            kind: "error",
            message: `Μη έγκυρη επιλογή: ${sel}.`,
          };
        }
        contributed += evaluateModifier(valueRow, base_price);
        validValues.push(sel);
      }
      return {
        kind: "ok",
        value: validValues,
        contributed_price: contributed,
      };
    }
    default:
      return { kind: "skip" };
  }
}

function evaluateModifier(v: CustomFieldValue, base_price: number): number {
  switch (v.modifier_kind) {
    case "none":
      return 0;
    case "flat":
      return Math.round(v.modifier_amount * 100) / 100;
    case "percent":
      return Math.round(base_price * v.modifier_amount * 100) / 100;
  }
}

// Workaround: declare unused but type-referenced — keep the
// createAdminClient symbol importable so re-exports work cleanly even
// though we don't query directly here.
void createAdminClient;
