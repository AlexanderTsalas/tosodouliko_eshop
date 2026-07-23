"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  CustomFieldWithValues,
  CustomFieldValue,
  CustomFieldDataType,
  TextValidation,
  NumberValidation,
  MultiSelectValidation,
  Translations,
} from "@/types/custom-fields";
import {
  Sparkles,
  ToggleRight,
  ChevronDown,
  ListChecks,
  Pencil,
  Hash,
  Check,
} from "lucide-react";
import type { ResolvedStorefrontField } from "@/lib/custom-fields/resolveStorefrontFields";
import { formatCurrency as format_price } from "@/lib/multi-currency/formatCurrency";
import {
  setStoreSnapshot,
  setFocusHandler,
  subscribeStore,
  getStoreSnapshot,
  valueKey,
} from "./_formStore";

interface Props {
  /** Resolved fields from the storefront resolver (visible only,
   *  deduped variant > product > category). */
  fields: ResolvedStorefrontField[];
  /** Variant base price used to evaluate `percent` modifiers. The
   *  storefront page passes the active variant's price (in active
   *  currency BEFORE offer discount — locked rule: percent modifiers
   *  compute on original base). */
  base_price: number;
  /** Active currency code for formatting. */
  currency_code: string;
}

type FieldValueState =
  | { kind: "boolean"; value: boolean | null }
  | { kind: "dropdown"; value: string | null }
  | { kind: "multi_select"; values: string[] }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number | null };

type ValuesMap = Map<string, FieldValueState>;

/**
 * Customer-facing custom-field form.
 *
 * Phase 8e: deterministic types — boolean / dropdown / multi_select.
 * Phase 8f: + text + number with per-type validation (maxLength /
 *           regex for text; min/max/step/integerOnly for number).
 *
 * Form holds the raw values + computes live modifier total
 * (modifiers only apply to deterministic values per the design lock).
 * Conditional sub-fields slide in when their parent value matches a
 * trigger.
 *
 * Validation feedback in 8f is PASSIVE — required asterisks, range
 * hints, regex error text. Active add-to-cart gating + freezing into
 * the order item happens in 8g.
 */
export default function ProductCustomFieldsForm({
  fields,
  base_price,
  currency_code,
}: Props) {
  // Render everything in 8f; deterministic + text + number.
  const renderableFields = useMemo(() => fields, [fields]);

  // Phase 8i: read the current customer-selected quantity from the
  // form store so per_unit fields render the right number of
  // instances. ProductDetailInteractive publishes via publishQuantity.
  const quantity = useSyncExternalStore(
    subscribeStore,
    () => getStoreSnapshot().quantity,
    () => 1
  );

  const [values, setValues] = useState<ValuesMap>(() => {
    // Seed per-line fields immediately. Per-unit fields seed lazily on
    // first interaction so we don't pre-create rows we may not need
    // when the customer hasn't bumped quantity yet.
    const initial: ValuesMap = new Map();
    for (const rf of renderableFields) {
      if (!rf.field.per_unit) {
        initial.set(rf.field.id, defaultStateFor(rf.field.data_type));
      }
    }
    return initial;
  });

  /** Patch a value at a composite key. For per-line fields the key is
   *  just `field_id`; for per-unit fields it's `field_id@unit_index`. */
  function patchValue(key: string, next: FieldValueState) {
    setValues((m) => {
      const cp = new Map(m);
      cp.set(key, next);
      return cp;
    });
  }

  /** Iterate every (rf, unit_index, state) tuple in the current form.
   *  Per-line fields → 1 tuple. Per-unit fields → `quantity` tuples,
   *  each at unit_index 0..quantity-1. Empty values are returned as
   *  `undefined` state so callers can flag missing-required. */
  function* iterateEntries(): Generator<{
    rf: ResolvedStorefrontField;
    unit_index: number | null;
    key: string;
    state: FieldValueState | undefined;
  }> {
    for (const rf of renderableFields) {
      if (rf.field.per_unit) {
        for (let i = 0; i < quantity; i++) {
          const k = valueKey(rf.field.id, i);
          yield { rf, unit_index: i, key: k, state: values.get(k) };
        }
      } else {
        const k = rf.field.id;
        yield { rf, unit_index: null, key: k, state: values.get(k) };
      }
    }
  }

  // Compute live modifier total across all rendered + actively visible
  // values, including triggered subfields when their parent value
  // satisfies the trigger. Per-unit fields contribute once per unit.
  const modifierTotal = useMemo(() => {
    let total = 0;
    function addForField(
      rf: ResolvedStorefrontField,
      state: FieldValueState | undefined
    ) {
      if (!state) return;
      switch (state.kind) {
        case "boolean":
          if (state.value === null) return;
          for (const v of rf.field.values) {
            if (asBoolean(v.value) === state.value) {
              total += modifierAmount(v, base_price);
              // Subfields triggered by this value
              const subs = rf.triggered_subfields.get(v.id);
              if (subs) for (const sf of subs) addForField(sf, values.get(sf.field.id));
              break;
            }
          }
          break;
        case "dropdown":
          if (!state.value) return;
          for (const v of rf.field.values) {
            if (asString(v.value) === state.value) {
              total += modifierAmount(v, base_price);
              const subs = rf.triggered_subfields.get(v.id);
              if (subs) for (const sf of subs) addForField(sf, values.get(sf.field.id));
              break;
            }
          }
          break;
        case "multi_select":
          for (const selectedKey of state.values) {
            for (const v of rf.field.values) {
              if (asString(v.value) === selectedKey) {
                total += modifierAmount(v, base_price);
                const subs = rf.triggered_subfields.get(v.id);
                if (subs) for (const sf of subs) addForField(sf, values.get(sf.field.id));
                break;
              }
            }
          }
          break;
        case "text":
        case "number":
          // Text + number fields have no price modifiers (locked rule:
          // only deterministic types carry modifiers). Always 0.
          break;
      }
    }
    for (const entry of iterateEntries()) {
      addForField(entry.rf, entry.state);
    }
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderableFields, values, base_price, quantity]);

  // Validation summary. Sets of offending KEYS (composite for per-unit
  // fields) are published to the store so the add-to-cart button can
  // gate. Per-unit fields contribute one missing-required key per
  // unfilled unit so all units must be filled before checkout.
  const missingRequiredFieldIds = useMemo(() => {
    const s = new Set<string>();
    for (const entry of iterateEntries()) {
      if (!entry.rf.effective_required) continue;
      if (isUnfilled(entry.state)) s.add(entry.key);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderableFields, values, quantity]);

  const invalidFieldIds = useMemo(() => {
    const s = new Set<string>();
    for (const entry of iterateEntries()) {
      if (!entry.state) continue;
      if (isValueInvalid(entry.rf, entry.state)) s.add(entry.key);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderableFields, values, quantity]);

  const missingRequiredCount = missingRequiredFieldIds.size;

  // Publish to the shared store on every change so the button reflects
  // current validity. Effect runs on every recompute; the store
  // listeners only re-render if something actually changed. `quantity`
  // is preserved as-is — it's owned by the publisher (ProductDetail-
  // Interactive), not the form.
  useEffect(() => {
    setStoreSnapshot({
      applicable: renderableFields,
      values,
      missingRequiredFieldIds,
      invalidFieldIds,
      quantity,
      modifier_total: modifierTotal,
    });
  }, [
    renderableFields,
    values,
    missingRequiredFieldIds,
    invalidFieldIds,
    quantity,
    modifierTotal,
  ]);

  // Scroll-to handler registered for the button to call on invalid
  // click attempts. Uses data-field-id anchors emitted by FieldRow.
  useEffect(() => {
    setFocusHandler((fid) => {
      if (typeof document === "undefined") return;
      const el = document.querySelector(
        `[data-field-id="${fid}"]`
      ) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Try to focus the first input/select/textarea inside the row.
      const focusable = el.querySelector(
        "input, select, textarea, button"
      ) as HTMLElement | null;
      focusable?.focus({ preventScroll: true });
    });
    return () => setFocusHandler(null);
  }, []);

  if (renderableFields.length === 0) return null;

  return (
    <div className="space-y-3 mt-6 pt-5 border-t border-border">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-terracotta" />
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-foreground/70">
          Προσαρμογή
        </h2>
      </div>

      {renderableFields.map((rf) => {
        // Per-line field → render once.
        if (!rf.field.per_unit || quantity <= 1) {
          const key = rf.field.id;
          return (
            <FieldRow
              key={key}
              rf={rf}
              state={values.get(key)}
              onChange={(next) => patchValue(key, next)}
              base_price={base_price}
              currency_code={currency_code}
              format_price={format_price}
              subfieldStates={values}
              onSubfieldChange={patchValue}
            />
          );
        }
        // Per-unit + qty > 1 → render `quantity` instances. Inline up
        // to 3 units; accordion-collapse beyond.
        return (
          <PerUnitGroup
            key={rf.field.id}
            rf={rf}
            quantity={quantity}
            values={values}
            onChange={patchValue}
            base_price={base_price}
            currency_code={currency_code}
            format_price={format_price}
            missingRequiredKeys={missingRequiredFieldIds}
            invalidKeys={invalidFieldIds}
          />
        );
      })}

      {missingRequiredCount > 0 && (
        <p className="text-xs text-amber-700">
          {missingRequiredCount === 1
            ? "1 υποχρεωτικό πεδίο παραμένει κενό."
            : `${missingRequiredCount} υποχρεωτικά πεδία παραμένουν κενά.`}
        </p>
      )}
    </div>
  );
}

// ─── One field's UI ─────────────────────────────────────────────────

// ─── Per-unit collection wrapper ─────────────────────────

/**
 * Renders the same field N times — one per unit when quantity > 1
 * AND the field is `per_unit`. Inline for quantity ≤ 3 (so the
 * customer sees every unit at once); accordion-collapsed for
 * quantity > 3 with a per-unit "Configure" toggle (so a 10-unit
 * order doesn't overwhelm the page).
 *
 * Subfields are NOT propagated through per-unit collection — per the
 * design lock, subfields fire from per-line parents only. Combining
 * per-unit + conditional sub-fields would multiply the form's
 * surface area unpredictably.
 */
function PerUnitGroup({
  rf,
  quantity,
  values,
  onChange,
  base_price,
  currency_code,
  format_price,
  missingRequiredKeys,
  invalidKeys,
}: {
  rf: ResolvedStorefrontField;
  quantity: number;
  values: ValuesMap;
  onChange: (key: string, next: FieldValueState) => void;
  base_price: number;
  currency_code: string;
  format_price: (amount: number, currency: string) => string;
  missingRequiredKeys: Set<string>;
  invalidKeys: Set<string>;
}) {
  const label =
    pickLabel(rf.field.label_translations) ?? rf.field.key;
  // Inline below the cap; accordion (collapsed-by-default) above.
  const useAccordion = quantity > 3;
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    // Default-open the first unit so the customer sees the input
    // shape on initial render even with accordion mode.
    return new Set([0]);
  });

  function toggleUnit(i: number) {
    setExpanded((s) => {
      const cp = new Set(s);
      if (cp.has(i)) cp.delete(i);
      else cp.add(i);
      return cp;
    });
  }

  const units = Array.from({ length: quantity }, (_, i) => i);

  return (
    <div data-field-id={rf.field.id} className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {label}
          {rf.effective_required && (
            <span className="text-destructive ml-0.5">*</span>
          )}
        </span>
        <span className="text-[10px] text-muted-foreground">
          ξεχωριστό ανά τεμάχιο · {quantity} τεμάχια
        </span>
      </div>

      <div className="space-y-2">
        {units.map((i) => {
          const key = valueKey(rf.field.id, i);
          const isExpanded = useAccordion ? expanded.has(i) : true;
          const state = values.get(key);
          const hasError =
            missingRequiredKeys.has(key) || invalidKeys.has(key);
          return (
            <div
              key={key}
              className={`rounded-md bg-background border ${
                hasError ? "border-amber-300" : "border-border"
              } overflow-hidden`}
            >
              <button
                type="button"
                onClick={
                  useAccordion ? () => toggleUnit(i) : undefined
                }
                disabled={!useAccordion}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm ${
                  useAccordion
                    ? "hover:bg-muted cursor-pointer"
                    : "cursor-default"
                }`}
              >
                <span className="font-medium text-foreground/80">
                  Τεμάχιο {i + 1}
                </span>
                {hasError && (
                  <span className="text-[10px] text-amber-700 font-medium uppercase tracking-wider">
                    Συμπληρώστε
                  </span>
                )}
                {useAccordion && (
                  <span className="ml-auto text-muted-foreground text-xs">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                )}
              </button>
              {isExpanded && (
                <div className="px-3 pb-3">
                  {/* We pass a minimal "rf" with the same field but
                      cleared subfields (per-unit fields don't
                      propagate subfields per the design lock). */}
                  <FieldRow
                    rf={{
                      ...rf,
                      triggered_subfields: new Map(),
                    }}
                    state={state}
                    onChange={(next) => onChange(key, next)}
                    base_price={base_price}
                    currency_code={currency_code}
                    format_price={format_price}
                    subfieldStates={values}
                    onSubfieldChange={onChange}
                    hideLabel
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldRow({
  rf,
  state,
  onChange,
  base_price,
  currency_code,
  format_price,
  subfieldStates,
  onSubfieldChange,
  hideLabel = false,
}: {
  rf: ResolvedStorefrontField;
  state: FieldValueState | undefined;
  onChange: (next: FieldValueState) => void;
  base_price: number;
  currency_code: string;
  format_price: (amount: number, currency: string) => string;
  subfieldStates: ValuesMap;
  /** Called with a COMPOSITE key (field_id or field_id@N) so subfield
   *  state lives at the same Map shape as the top-level form. */
  onSubfieldChange: (key: string, next: FieldValueState) => void;
  /** Hide the field's own label — used when wrapped by `PerUnitGroup`
   *  which renders the group label above the unit accordion. */
  hideLabel?: boolean;
}) {
  const label = pickLabel(rf.field.label_translations) ?? rf.field.key;
  const dt = rf.field.data_type;

  // Track which value is currently selected (for subfield activation).
  const activeValueIds = activeValueIdsFor(rf.field, state);

  // "Filled" — the field has any user-provided value. Drives the
  // emerald tint on the card so customers can scan which options
  // they've already touched without re-reading them.
  const filled = !isUnfilled(state);

  // Per-type icon prefix on the label. Gives each field type a small
  // visual signature so a row of boolean / dropdown / text inputs
  // reads as distinct items, not as a wall of identical labels.
  const TypeIcon =
    dt === "boolean"
      ? ToggleRight
      : dt === "dropdown"
        ? ChevronDown
        : dt === "multi_select"
          ? ListChecks
          : dt === "number"
            ? Hash
            : Pencil;

  // Card-wrap top-level fields so they read as distinct add-ons.
  // Nested usages (per-unit accordion bodies via `hideLabel`) skip
  // the wrapper to avoid double-bordering inside the group card.
  // No bordered container around top-level fields — they read as clean
  // label + control rows, separated by the parent's spacing.
  const cardClass = hideLabel ? "" : "relative";

  return (
    <div data-field-id={rf.field.id} className={cardClass}>
      {!hideLabel && dt === "boolean" ? (
        // Boolean fields read as a single compact row: label, then the toggle
        // sitting right next to it (not pushed to the far edge).
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <TypeIcon className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{label}</span>
            {rf.effective_required && <span className="text-destructive">*</span>}
          </span>
          <BooleanInput
            field={rf.field}
            state={state}
            onChange={onChange}
            base_price={base_price}
            currency_code={currency_code}
            format_price={format_price}
          />
        </div>
      ) : (
        <>
          {!hideLabel && (
            <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
              <TypeIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{label}</span>
              {rf.effective_required && <span className="text-destructive">*</span>}
              {filled && <Check className="w-3.5 h-3.5 ml-auto text-terracotta" />}
            </label>
          )}

          {dt === "boolean" && (
            <BooleanInput
              field={rf.field}
              state={state}
              onChange={onChange}
              base_price={base_price}
              currency_code={currency_code}
              format_price={format_price}
            />
          )}
          {dt === "dropdown" && (
            <DropdownInput
              field={rf.field}
              state={state}
              onChange={onChange}
              base_price={base_price}
              currency_code={currency_code}
              format_price={format_price}
            />
          )}
          {dt === "multi_select" && (
            <MultiSelectInput
              field={rf.field}
              state={state}
              onChange={onChange}
              base_price={base_price}
              currency_code={currency_code}
              format_price={format_price}
            />
          )}
          {dt === "text" && (
            <TextInput field={rf.field} state={state} onChange={onChange} />
          )}
          {dt === "number" && (
            <NumberInput field={rf.field} state={state} onChange={onChange} />
          )}
        </>
      )}

      {/* Display messages from any currently-selected value */}
      {activeValueIds.map((vid) => {
        const v = rf.field.values.find((x) => x.id === vid);
        if (!v?.message_translations) return null;
        const message = pickLabel(v.message_translations);
        if (!message) return null;
        return (
          <p
            key={`msg-${vid}`}
            className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1.5 mt-1.5"
          >
            ℹ {message}
          </p>
        );
      })}

      {/* Conditional sub-fields triggered by the currently selected
          value(s). Depth-1 only — sub-fields themselves don't trigger
          deeper children. */}
      {activeValueIds.map((vid) => {
        const subs = rf.triggered_subfields.get(vid);
        if (!subs || subs.length === 0) return null;
        return (
          <div
            key={`subs-${vid}`}
            className="mt-3 ml-3 pl-3 border-l-2 border-foreground/15 space-y-3"
          >
            {subs.map((sub) => (
              <FieldRow
                key={sub.field.id}
                rf={sub}
                state={subfieldStates.get(sub.field.id)}
                onChange={(next) => onSubfieldChange(sub.field.id, next)}
                base_price={base_price}
                currency_code={currency_code}
                format_price={format_price}
                subfieldStates={subfieldStates}
                onSubfieldChange={onSubfieldChange}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Per-type inputs ────────────────────────────────────────────────

function BooleanInput({
  field,
  state,
  onChange,
  base_price,
  currency_code,
  format_price,
}: {
  field: CustomFieldWithValues;
  state: FieldValueState | undefined;
  onChange: (next: FieldValueState) => void;
  base_price: number;
  currency_code: string;
  format_price: (amount: number, currency: string) => string;
}) {
  // Compact toggle: "off" by default, slides "on" when picked. The
  // active price modifier (if the Yes-value carries one) renders
  // inline to the right so customers see the cost without a second
  // summary block.
  const trueValue = field.values.find((v) => asBoolean(v.value) === true);
  const checked = state?.kind === "boolean" && state.value === true;
  const onModText = trueValue
    ? modifierBadge(trueValue, base_price, currency_code, format_price)
    : null;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange({ kind: "boolean", value: !checked })}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-terracotta" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
      <span className="text-sm">{checked ? "Ναι" : "Όχι"}</span>
      {checked && onModText && (
        <span className="text-xs text-muted-foreground">{onModText}</span>
      )}
    </div>
  );
}

function DropdownInput({
  field,
  state,
  onChange,
  base_price,
  currency_code,
  format_price,
}: {
  field: CustomFieldWithValues;
  state: FieldValueState | undefined;
  onChange: (next: FieldValueState) => void;
  base_price: number;
  currency_code: string;
  format_price: (amount: number, currency: string) => string;
}) {
  const current = state?.kind === "dropdown" ? state.value : null;
  return (
    <div className="space-y-1.5">
      {field.values.map((v) => {
        const key = asString(v.value);
        const selected = current === key;
        const modText = modifierBadge(v, base_price, currency_code, format_price);
        return (
          <label
            key={v.id}
            className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors ${
              selected
                ? "border-terracotta bg-terracotta/10"
                : "border-border hover:bg-muted"
            }`}
          >
            <input
              type="radio"
              name={`field-${field.id}`}
              checked={selected}
              onChange={() => onChange({ kind: "dropdown", value: key })}
            />
            <span className="flex-1 text-sm">
              {pickLabel(v.label_translations) ?? key}
            </span>
            {modText && (
              <span className="text-xs text-muted-foreground">{modText}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function MultiSelectInput({
  field,
  state,
  onChange,
  base_price,
  currency_code,
  format_price,
}: {
  field: CustomFieldWithValues;
  state: FieldValueState | undefined;
  onChange: (next: FieldValueState) => void;
  base_price: number;
  currency_code: string;
  format_price: (amount: number, currency: string) => string;
}) {
  const selectedSet = new Set<string>(
    state?.kind === "multi_select" ? state.values : []
  );
  function toggle(key: string) {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({ kind: "multi_select", values: Array.from(next) });
  }
  return (
    <div className="space-y-1.5">
      {field.values.map((v) => {
        const key = asString(v.value);
        const selected = selectedSet.has(key);
        const modText = modifierBadge(v, base_price, currency_code, format_price);
        return (
          <label
            key={v.id}
            className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors ${
              selected
                ? "border-terracotta bg-terracotta/10"
                : "border-border hover:bg-muted"
            }`}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggle(key)}
            />
            <span className="flex-1 text-sm">
              {pickLabel(v.label_translations) ?? key}
            </span>
            {modText && (
              <span className="text-xs text-muted-foreground">{modText}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

// ─── Text + number inputs ────────────────────────────────

function TextInput({
  field,
  state,
  onChange,
}: {
  field: CustomFieldWithValues;
  state: FieldValueState | undefined;
  onChange: (next: FieldValueState) => void;
}) {
  const validation = field.validation as TextValidation;
  const maxLength = validation.maxLength;
  const regex = validation.regex;
  const current = state?.kind === "text" ? state.value : "";

  // Use a textarea when the admin allows a long string (>100 chars
  // worth of content). For short labels (names, codes), a single-line
  // input is more compact and faster to fill on mobile.
  // Only explicitly-long fields get a textarea; everything else (names, short
  // notes) is a single-line input so it doesn't render a huge empty box.
  const useTextarea = typeof maxLength === "number" && maxLength > 120;

  // Regex validity — only flagged when the customer has typed
  // something (an empty field is "unfilled", not "invalid").
  let regexError: string | null = null;
  if (current.length > 0 && regex) {
    try {
      const re = new RegExp(regex);
      if (!re.test(current)) {
        regexError = "Η μορφή δεν είναι σωστή.";
      }
    } catch {
      // Malformed regex configured by the admin — ignore so it doesn't
      // block the customer.
    }
  }

  const baseInput =
    "px-3 py-2 rounded-sm border border-stone-taupe/30 bg-card focus:outline-none focus:ring-2 focus:ring-terracotta/20";
  const inputProps = {
    value: current,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onChange({ kind: "text", value: e.target.value }),
    maxLength: maxLength,
  };

  return (
    <div>
      {useTextarea ? (
        <textarea
          {...(inputProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          rows={2}
          className={`${baseInput} w-full`}
        />
      ) : (
        <input
          type="text"
          {...(inputProps as React.InputHTMLAttributes<HTMLInputElement>)}
          className={`${baseInput} w-full max-w-xs`}
        />
      )}
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-muted-foreground">
          {regexError ? (
            <span className="text-destructive">{regexError}</span>
          ) : maxLength ? (
            `έως ${maxLength} χαρακτήρες`
          ) : (
            ""
          )}
        </span>
        {maxLength && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {current.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}

function NumberInput({
  field,
  state,
  onChange,
}: {
  field: CustomFieldWithValues;
  state: FieldValueState | undefined;
  onChange: (next: FieldValueState) => void;
}) {
  const validation = field.validation as NumberValidation;
  const min = validation.min;
  const max = validation.max;
  const integerOnly = validation.integerOnly === true;
  // integerOnly forces step=1 unless admin set a non-1 step explicitly.
  const step = validation.step ?? (integerOnly ? 1 : undefined);

  const current = state?.kind === "number" ? state.value : null;
  const currentStr = current === null || Number.isNaN(current) ? "" : String(current);

  // Compute the validation error for the customer.
  let error: string | null = null;
  if (current !== null && !Number.isNaN(current)) {
    if (integerOnly && !Number.isInteger(current)) {
      error = "Δεκτοί μόνο ακέραιοι αριθμοί.";
    } else if (min !== undefined && current < min) {
      error = `Τουλάχιστον ${min}.`;
    } else if (max !== undefined && current > max) {
      error = `Έως ${max}.`;
    }
  }

  return (
    <div>
      <input
        type="number"
        value={currentStr}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange({ kind: "number", value: null });
            return;
          }
          const parsed = parseFloat(raw);
          onChange({
            kind: "number",
            value: Number.isNaN(parsed) ? null : parsed,
          });
        }}
        className="w-full max-w-xs px-3 py-2 rounded-sm border border-stone-taupe/30 bg-card focus:outline-none focus:ring-2 focus:ring-terracotta/20"
      />
      <div className="text-xs mt-1">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <span className="text-muted-foreground">
            {rangeLabel(min, max, integerOnly)}
          </span>
        )}
      </div>
    </div>
  );
}

function rangeLabel(
  min: number | undefined,
  max: number | undefined,
  integerOnly: boolean
): string {
  const parts: string[] = [];
  if (min !== undefined && max !== undefined) parts.push(`${min}–${max}`);
  else if (min !== undefined) parts.push(`από ${min} και πάνω`);
  else if (max !== undefined) parts.push(`έως ${max}`);
  if (integerOnly) parts.push("ακέραιοι");
  return parts.join(" · ");
}

// ─── Helpers ────────────────────────────────────────────────────────

function defaultStateFor(dt: CustomFieldDataType): FieldValueState {
  switch (dt) {
    case "boolean":
      return { kind: "boolean", value: null };
    case "dropdown":
      return { kind: "dropdown", value: null };
    case "multi_select":
      return { kind: "multi_select", values: [] };
    case "text":
      return { kind: "text", value: "" };
    case "number":
      return { kind: "number", value: null };
  }
}

/**
 * True when a filled value is currently invalid per the field's
 * validation rules (regex, range, integerOnly, multi-select counts).
 * Empty values are NOT considered invalid here — that's separate
 * "unfilled" status for required fields.
 */
function isValueInvalid(
  rf: ResolvedStorefrontField,
  state: FieldValueState
): boolean {
  switch (state.kind) {
    case "boolean":
    case "dropdown":
      return false;
    case "multi_select": {
      const v = rf.field.validation as MultiSelectValidation;
      if (
        typeof v.minSelections === "number" &&
        state.values.length > 0 &&
        state.values.length < v.minSelections
      )
        return true;
      if (
        typeof v.maxSelections === "number" &&
        state.values.length > v.maxSelections
      )
        return true;
      return false;
    }
    case "text": {
      const v = rf.field.validation as TextValidation;
      if (state.value.trim().length === 0) return false;
      if (typeof v.maxLength === "number" && state.value.length > v.maxLength)
        return true;
      if (typeof v.regex === "string" && v.regex.length > 0) {
        try {
          if (!new RegExp(v.regex).test(state.value)) return true;
        } catch {
          /* malformed admin regex — ignore */
        }
      }
      return false;
    }
    case "number": {
      if (state.value === null || Number.isNaN(state.value)) return false;
      const v = rf.field.validation as NumberValidation;
      if (v.integerOnly && !Number.isInteger(state.value)) return true;
      if (typeof v.min === "number" && state.value < v.min) return true;
      if (typeof v.max === "number" && state.value > v.max) return true;
      return false;
    }
  }
}

function isUnfilled(state: FieldValueState | undefined): boolean {
  if (!state) return true;
  switch (state.kind) {
    case "boolean":
      return state.value === null;
    case "dropdown":
      return state.value === null || state.value.length === 0;
    case "multi_select":
      return state.values.length === 0;
    case "text":
      return state.value.trim().length === 0;
    case "number":
      return state.value === null || Number.isNaN(state.value);
  }
}

function activeValueIdsFor(
  field: CustomFieldWithValues,
  state: FieldValueState | undefined
): string[] {
  if (!state) return [];
  switch (state.kind) {
    case "boolean":
      if (state.value === null) return [];
      return field.values
        .filter((v) => asBoolean(v.value) === state.value)
        .map((v) => v.id);
    case "dropdown":
      if (!state.value) return [];
      return field.values
        .filter((v) => asString(v.value) === state.value)
        .map((v) => v.id);
    case "multi_select":
      return field.values
        .filter((v) => state.values.includes(asString(v.value)))
        .map((v) => v.id);
    case "text":
    case "number":
      // Text + number values are open-ended — they don't index into
      // the per-value subfield/message tables (only deterministic
      // values can trigger). Locked rule from the design phase.
      return [];
  }
}

function modifierAmount(v: CustomFieldValue, base_price: number): number {
  switch (v.modifier_kind) {
    case "none":
      return 0;
    case "flat":
      return v.modifier_amount;
    case "percent":
      // Locked rule: percent modifiers compute against ORIGINAL base
      // price (pre-discount). The storefront passes the variant's
      // current price as base_price — the offer discount, when added
      // in 8g, won't affect this value.
      return base_price * v.modifier_amount;
  }
}

function modifierBadge(
  v: CustomFieldValue,
  base_price: number,
  currency: string,
  format_price: (amount: number, currency: string) => string
): string | null {
  const amount = modifierAmount(v, base_price);
  if (amount === 0) return null;
  const sign = amount >= 0 ? "+" : "−";
  return `${sign}${format_price(Math.abs(amount), currency)}`;
}

function asBoolean(value: CustomFieldValue["value"]): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asString(value: CustomFieldValue["value"]): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function pickLabel(translations: Translations | null): string | null {
  if (!translations) return null;
  // Greek first, English fallback. The shape is Record<string,string>
  // so missing keys come back as undefined at runtime; TypeScript
  // sees them as `string` but the `||` chain handles both.
  return translations.el || translations.en || null;
}
