"use client";

import type { ResolvedStorefrontField } from "@/lib/custom-fields/resolveStorefrontFields";

/**
 * Module-scoped store coordinating the storefront custom-fields form
 * with the add-to-cart button living elsewhere on the same product
 * page. Both components import from this module so the button knows:
 *
 *   - The current per-field values (to send with addToCart)
 *   - Whether the form is currently valid (to gate the click)
 *   - Which field to scroll-to on an invalid click attempt
 *
 * The store is intentionally tiny — `useSyncExternalStore` is enough.
 * It resets on each product-page mount because:
 *   - The form is a fresh React tree mount on navigation
 *   - The form's `useEffect` re-publishes its current values on every
 *     remount, overwriting any leftover state from a previous page
 *
 * Boundaries:
 *   - Server code MUST NOT import this; values are client-only and
 *     re-validated on the server by the cart action regardless.
 *   - Only one form per page is supported (single product). Multiple
 *     forms would race over the same store; not a v1 case.
 */

export type FormStateValue =
  | { kind: "boolean"; value: boolean | null }
  | { kind: "dropdown"; value: string | null }
  | { kind: "multi_select"; values: string[] }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number | null };

interface FormSnapshot {
  applicable: ResolvedStorefrontField[];
  /** Composite key shape:
   *   - per-line field            → `${field_id}`
   *   - per-unit field, unit N   → `${field_id}@${unit_index}`
   *  Serialization picks the right `unit_index` from the key. */
  values: Map<string, FormStateValue>;
  /** Required fields not currently filled. Keys match `values`'
   *  composite shape so per-unit instances are tracked separately. */
  missingRequiredFieldIds: Set<string>;
  /** Fields with a typed value but failing per-type validation
   *  (regex mismatch, out-of-range number, etc). Same composite key. */
  invalidFieldIds: Set<string>;
  /** Current quantity selected by the customer. Phase 8i — drives
   *  per-unit collection (a per_unit field renders `quantity`
   *  instances). Defaults to 1 when no publisher has updated it. */
  quantity: number;
  /** Sum of the active price modifiers (in the customer's active
   *  currency), published by the form so the price line above the
   *  CTA can render "+ X" inline instead of the form needing its
   *  own price-summary block. */
  modifier_total: number;
}

const initialSnapshot: FormSnapshot = {
  applicable: [],
  values: new Map(),
  missingRequiredFieldIds: new Set(),
  invalidFieldIds: new Set(),
  quantity: 1,
  modifier_total: 0,
};

let snapshot: FormSnapshot = initialSnapshot;
let focusHandler: ((field_id: string) => void) | null = null;
const listeners = new Set<() => void>();

export function getStoreSnapshot(): FormSnapshot {
  return snapshot;
}

export function setStoreSnapshot(next: FormSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

export function subscribeStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Form registers itself so the button can ask "please scroll-to and
 *  focus the first offending field". */
export function setFocusHandler(fn: ((field_id: string) => void) | null) {
  focusHandler = fn;
}

/** Quantity publisher — called by ProductDetailInteractive whenever
 *  the customer changes the qty selector. The form subscribes to the
 *  snapshot and re-renders per-unit sections accordingly. */
export function publishQuantity(qty: number) {
  if (snapshot.quantity === qty) return; // no-op
  snapshot = { ...snapshot, quantity: qty };
  for (const l of listeners) l();
}

/** Composite key for a per-unit field instance. */
export function valueKey(field_id: string, unit_index: number | null): string {
  return unit_index === null ? field_id : `${field_id}@${unit_index}`;
}

/** Reverse of valueKey — parses out (field_id, unit_index). */
export function parseValueKey(
  key: string
): { field_id: string; unit_index: number | null } {
  const idx = key.indexOf("@");
  if (idx === -1) return { field_id: key, unit_index: null };
  return {
    field_id: key.slice(0, idx),
    unit_index: parseInt(key.slice(idx + 1), 10),
  };
}

/** Called by the button on an invalid click attempt — pulls the first
 *  offender (missing-required has priority over typed-invalid) from
 *  the current snapshot. For per-unit fields the offender key carries
 *  `@N`; we strip the suffix when calling the focus handler so it
 *  resolves to a DOM anchor that matches by field_id (the renderer
 *  emits one anchor per field, not per unit). */
export function focusFirstOffender(): string | null {
  for (const rf of snapshot.applicable) {
    const match = firstMatching(snapshot.missingRequiredFieldIds, rf.field.id);
    if (match) {
      focusHandler?.(rf.field.id);
      return match;
    }
  }
  for (const rf of snapshot.applicable) {
    const match = firstMatching(snapshot.invalidFieldIds, rf.field.id);
    if (match) {
      focusHandler?.(rf.field.id);
      return match;
    }
  }
  return null;
}

function firstMatching(set: Set<string>, field_id: string): string | null {
  for (const key of set) {
    const parsed = parseValueKey(key);
    if (parsed.field_id === field_id) return key;
  }
  return null;
}

/** True when no required missing AND no typed-invalid fields. */
export function isFormValid(): boolean {
  return (
    snapshot.missingRequiredFieldIds.size === 0 &&
    snapshot.invalidFieldIds.size === 0
  );
}

/** Build the array that addToCart accepts. Skips fields with no
 *  user input so we don't persist empty rows; the server validator
 *  will then catch any required ones that are missing. Per-unit
 *  fields emit one row per unit with `unit_index` set. */
export function getSubmittableValues(): Array<{
  field_id: string;
  unit_index?: number | null;
  value: unknown;
}> {
  const out: Array<{
    field_id: string;
    unit_index?: number | null;
    value: unknown;
  }> = [];
  for (const [key, state] of snapshot.values.entries()) {
    const serialized = serializeStateValue(state);
    if (serialized === undefined) continue;
    const { field_id, unit_index } = parseValueKey(key);
    out.push({ field_id, unit_index, value: serialized });
  }
  return out;
}

function serializeStateValue(state: FormStateValue): unknown {
  switch (state.kind) {
    case "boolean":
      return state.value === null ? undefined : state.value;
    case "dropdown":
      return state.value === null || state.value.length === 0
        ? undefined
        : state.value;
    case "multi_select":
      return state.values.length === 0 ? undefined : state.values;
    case "text":
      return state.value.trim().length === 0 ? undefined : state.value;
    case "number":
      return state.value === null || Number.isNaN(state.value)
        ? undefined
        : state.value;
  }
}
