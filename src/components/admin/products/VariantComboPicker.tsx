"use client";

import {
  buildVariantSku,
  comboKey,
  computeVariantPrice,
  type PendingPair,
} from "@/lib/variants-helpers";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

interface Props {
  /**
   * Pre-computed combinations (cartesian product of staged pairs). The
   * parent decides what to feed in:
   *   - AxesEditor (add value): one combo per existing sibling shape
   *     with the new value swapped in
   *   - AxesEditor (add new axis): existing variants × new axis values
   */
  combinations: PendingPair[][];
  /** Base price for the SKU/price preview column. */
  basePrice: number;
  /** Currency code (ISO 4217) for label rendering. */
  currency?: string;
  /** SKU prefix used to build per-row SKU previews. */
  baseSku: string;
  /** Attribute catalog (for price modifier resolution). */
  attributes: Attribute[];
  /** Attribute-value catalog (for price modifier + display lookups). */
  attributeValues: AttributeValue[];
  /** Canonical keys of combos the admin opted out of. */
  skippedComboKeys: Set<string>;
  onSkippedChange: (next: Set<string>) => void;
  /**
   * Per-row admin price overrides, keyed by canonical combo key. Optional
   * — when the parent doesn't want price editing (e.g. post-create flows
   * that only collect a single price), it can omit both this prop and
   * onPriceOverrideChange and the price column becomes display-only.
   */
  priceOverrides?: Record<string, number>;
  onPriceOverrideChange?: (next: Record<string, number>) => void;
  /**
   * Combos that already exist on the product. Rows whose canonical key
   * appears here are rendered disabled with an "Υπάρχει ήδη" badge — the
   * admin can still see them in the matrix but can't choose to recreate
   * them. The parent must NOT include these keys in skippedComboKeys
   * itself; the picker auto-filters them out at submit time via the
   * `selectedCombosFromPicker` helper exported below.
   */
  existingShapeKeys?: Set<string>;
  /**
   * Optional helper text shown above the table — overrides the default
   * "Ξεμαρκάρετε όσους συνδυασμούς δεν θέλετε να δημιουργηθούν."
   */
  helperText?: string;
  /**
   * When true, the checkbox column renders even when there's a single
   * row. Use for opt-in flows (gap-fill, single-combo confirmation)
   * where the admin's tick is the act of opting IN — without it, the
   * row would render with no way to confirm or decline.
   *
   * For opt-in semantics, the parent should ALSO initialize
   * `skippedComboKeys` with every candidate's key so the rows start
   * unchecked, and supply a helperText like "Μαρκάρετε όσους
   * συνδυασμούς θέλετε να δημιουργηθούν." The picker treats "skipped"
   * the same in both modes — only the parent's initial state and
   * copy differ.
   */
  alwaysShowCheckbox?: boolean;
}

/**
 * Iteration list for variant combinations. Used at both the initial
 * product create flow and the post-create axis-expansion flow so the
 * admin always sees + confirms which combinations will be created.
 *
 * Defaults to all combinations selected (skippedComboKeys is empty at
 * mount). The admin unchecks rows they don't want. Existing combos (the
 * `existingShapeKeys` prop) render disabled.
 *
 * The component is presentational — all state is held by the parent so
 * the picker can be used identically in flows that submit per-variant
 * data and flows that submit a flat list of shapes to a server action
 * (AxesEditor).
 */
export default function VariantComboPicker({
  combinations,
  basePrice,
  currency: _currency, // reserved for future per-row currency display
  baseSku,
  attributes,
  attributeValues,
  skippedComboKeys,
  onSkippedChange,
  priceOverrides,
  onPriceOverrideChange,
  existingShapeKeys,
  helperText,
  alwaysShowCheckbox,
}: Props) {
  const totalCombinations = combinations.length;
  const existingSet = existingShapeKeys ?? new Set<string>();
  const priceEditable = priceOverrides !== undefined && onPriceOverrideChange !== undefined;

  if (totalCombinations === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Δεν υπάρχουν συνδυασμοί προς δημιουργία.
      </p>
    );
  }

  // Build the rows once. We don't memoize because the parent already
  // re-renders only when inputs change, and the combinations array is
  // small (rarely > 50).
  const rows = combinations.map((combo, idx) => {
    const key = comboKey(combo);
    const computed = computeVariantPrice(
      basePrice,
      combo,
      attributes,
      attributeValues
    );
    const finalPrice = priceOverrides?.[key] ?? computed.total;
    const isExisting = existingSet.has(key);
    const isSkipped = isExisting || skippedComboKeys.has(key);
    return {
      idx,
      combo,
      key,
      sku: buildVariantSku(baseSku || "SKU", combo, totalCombinations),
      suggested: computed.total,
      breakdown: computed.breakdown,
      finalPrice,
      isSkipped,
      isExisting,
    };
  });

  const newRowsCount = rows.filter((r) => !r.isExisting).length;
  // Default: hide the checkbox when there's only one new row — single
  // combo can't be meaningfully "skipped" in the create-product happy
  // path. Opt-in flows (gap-fill) override via alwaysShowCheckbox so
  // the user can actively tick to confirm.
  const showCheckboxColumn = alwaysShowCheckbox || newRowsCount > 1;

  function toggleSkip(key: string, included: boolean) {
    const next = new Set(skippedComboKeys);
    if (included) next.delete(key);
    else next.add(key);
    onSkippedChange(next);
  }

  function setOverride(key: string, value: number) {
    if (!priceEditable) return;
    onPriceOverrideChange!({ ...priceOverrides!, [key]: value });
  }

  function clearOverride(key: string) {
    if (!priceEditable) return;
    const { [key]: _, ...rest } = priceOverrides!;
    onPriceOverrideChange!(rest);
  }

  return (
    <div>
      {helperText !== undefined ? (
        helperText && (
          <p className="text-xs text-muted-foreground mb-2">{helperText}</p>
        )
      ) : (
        showCheckboxColumn && (
          <p className="text-xs text-muted-foreground mb-2">
            Ξεμαρκάρετε όσους συνδυασμούς δεν θέλετε να δημιουργηθούν.
          </p>
        )
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            {showCheckboxColumn && <th className="py-2 w-8"></th>}
            <th className="py-2">SKU</th>
            <th className="py-2">Χαρακτηριστικά</th>
            <th className="py-2 w-40">Τιμή</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOverridden = priceOverrides?.[row.key] !== undefined;
            const hasModifiers = row.breakdown.length > 0;
            const rowMuted = row.isSkipped ? "opacity-50" : "";
            return (
              <tr key={row.key} className={"border-b align-top " + rowMuted}>
                {showCheckboxColumn && (
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={!row.isSkipped}
                      disabled={row.isExisting}
                      onChange={(e) => toggleSkip(row.key, e.target.checked)}
                      aria-label="Περιλαμβάνεται στη δημιουργία"
                    />
                  </td>
                )}
                <td className="py-2 font-mono text-xs">
                  <span className={row.isSkipped ? "line-through" : ""}>
                    {row.sku}
                  </span>
                  {row.isExisting && (
                    <span className="ml-2 text-[10px] rounded bg-muted px-1 py-0.5 text-muted-foreground">
                      Υπάρχει ήδη
                    </span>
                  )}
                </td>
                <td className="py-2">
                  {row.combo.length === 0 ? (
                    <span className="text-muted-foreground text-xs">default</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.combo.map((p) => (
                        <span
                          key={p.attributeSlug + p.value}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs"
                        >
                          {p.attributeName}: {p.value}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2">
                  {priceEditable ? (
                    <>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={priceOverrides?.[row.key] ?? row.suggested}
                        disabled={row.isExisting}
                        onChange={(e) => setOverride(row.key, Number(e.target.value))}
                        className={
                          "w-24 border rounded px-2 py-1 text-center " +
                          (isOverridden ? "border-amber-500" : "")
                        }
                      />
                      {hasModifiers && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {basePrice.toFixed(2)} base
                          {row.breakdown.map((b) => (
                            <span key={b.attributeSlug}>
                              {" "}+ {b.modifier.toFixed(2)} {b.attributeName}
                            </span>
                          ))}
                        </p>
                      )}
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => clearOverride(row.key)}
                          className="text-[10px] text-muted-foreground underline mt-0.5"
                        >
                          Επαναφορά
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="font-mono text-xs">
                      {row.finalPrice.toFixed(2)}
                      {hasModifiers && (
                        <span className="block text-[10px] text-muted-foreground">
                          {basePrice.toFixed(2)} base
                          {row.breakdown.map((b) => (
                            <span key={b.attributeSlug}>
                              {" "}+ {b.modifier.toFixed(2)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Convenience: given the picker's inputs, return only the combinations
 * the admin opted IN (not skipped, not existing). Use at submit time to
 * construct the targetShapes payload for the server action.
 */
export function selectedCombosFromPicker(
  combinations: PendingPair[][],
  skippedComboKeys: Set<string>,
  existingShapeKeys?: Set<string>
): PendingPair[][] {
  const existing = existingShapeKeys ?? new Set<string>();
  return combinations.filter((combo) => {
    const key = comboKey(combo);
    if (existing.has(key)) return false;
    if (skippedComboKeys.has(key)) return false;
    return true;
  });
}
