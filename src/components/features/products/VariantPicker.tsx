"use client";

import { useMemo, useState } from "react";
import type { ProductVariant } from "@/types/product-variants";

/** Shape of attribute_values rows the picker needs to render chips. */
export interface PickerValueLookup {
  id: string;
  value: string;
  display_order: number;
}

interface Props {
  variants: ProductVariant[];
  /** Pre-selected variant (e.g. from a split-listing URL). Falls back to variants[0]. */
  initialVariantId?: string | null;
  /** Optional display names for attribute slugs (e.g. {"bottle-size": "Bottle size"}). */
  attributeNames?: Record<string, string>;
  /** Pre-computed price labels per variant id, already in the active display currency. */
  variantPriceLabels?: Record<string, string>;
  /**
   * attribute_values keyed by id. Used to resolve combo UUIDs into display
   * text. Only needs to include values referenced by the current product's
   * variants; the page resolves and passes them server-side.
   */
  valuesById: Record<string, PickerValueLookup>;
  onChange?: (variantId: string) => void;
}

/**
 * One row per attribute, chip buttons per value. Selecting a chip snaps to
 * the variant whose attribute_combo best matches the resulting selection;
 * incompatible values are disabled but not hidden, so the option space stays
 * legible (Shopify-style).
 */
export default function VariantPicker({
  variants,
  initialVariantId,
  attributeNames,
  valuesById,
  onChange,
}: Props) {
  // Build attribute → ordered unique value-ids. Sort within each axis by the
  // attribute_values.display_order, so admin-defined ordering is honored.
  const attrOrder = useMemo<string[]>(() => {
    const seen: string[] = [];
    for (const v of variants) {
      if (!v.attribute_combo) continue;
      for (const slug of Object.keys(v.attribute_combo)) {
        if (!seen.includes(slug)) seen.push(slug);
      }
    }
    return seen;
  }, [variants]);

  const valuesByAttr = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const slug of attrOrder) out[slug] = [];
    for (const v of variants) {
      if (!v.attribute_combo) continue;
      for (const [slug, valueId] of Object.entries(v.attribute_combo)) {
        if (!out[slug].includes(valueId)) out[slug].push(valueId);
      }
    }
    // Sort each axis by attribute_values.display_order.
    for (const slug of attrOrder) {
      out[slug].sort((a, b) => {
        const da = valuesById[a]?.display_order ?? 0;
        const db = valuesById[b]?.display_order ?? 0;
        return da - db;
      });
    }
    return out;
  }, [variants, attrOrder, valuesById]);

  // Seed selection from initialVariantId or the first variant.
  const seedVariant =
    (initialVariantId && variants.find((v) => v.id === initialVariantId)) ||
    variants[0] ||
    null;
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    if (!seedVariant?.attribute_combo) return {};
    return { ...seedVariant.attribute_combo };
  });

  /** Find a variant matching `sel` exactly; if none, find the variant matching the most keys. */
  function resolveVariant(sel: Record<string, string>): ProductVariant | null {
    if (variants.length === 0) return null;
    if (Object.keys(sel).length === 0) return variants[0];
    let best: { variant: ProductVariant; score: number } | null = null;
    for (const v of variants) {
      const combo = v.attribute_combo ?? {};
      let score = 0;
      let hardMismatch = false;
      for (const [slug, val] of Object.entries(sel)) {
        if (combo[slug] === val) score += 2;
        else if (combo[slug] !== undefined) hardMismatch = true;
      }
      if (hardMismatch) continue;
      if (!best || score > best.score) best = { variant: v, score };
    }
    return best?.variant ?? null;
  }

  /** Would picking (slug=value) on top of the current selection yield any real variant? */
  function isReachable(slug: string, value: string): boolean {
    const candidate = { ...selection, [slug]: value };
    return resolveVariant(candidate) !== null;
  }

  function pick(slug: string, value: string) {
    // Snap to the matching variant. Merge — never replace — so picking a
    // narrower variant doesn't silently drop unrelated axis selections.
    const candidate = { ...selection, [slug]: value };
    const variant = resolveVariant(candidate);
    if (!variant) return;
    const nextSel = { ...selection, ...(variant.attribute_combo ?? candidate) };
    setSelection(nextSel);
    onChange?.(variant.id);
  }

  function labelFor(slug: string): string {
    if (attributeNames?.[slug]) return attributeNames[slug];
    return slug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (variants.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {attrOrder.map((slug) => {
        const values = valuesByAttr[slug];
        const selectedValueId = selection[slug];
        const selectedDisplay = selectedValueId
          ? valuesById[selectedValueId]?.value
          : undefined;
        return (
          <fieldset key={slug} className="flex flex-col gap-4">
            <legend className="text-sm font-medium mb-1">
              {labelFor(slug)}
              {selectedDisplay && (
                <span className="ml-2 text-muted-foreground font-normal">
                  {selectedDisplay}
                </span>
              )}
            </legend>
            <div className="flex flex-wrap gap-2">
              {values.map((valId) => {
                const isSelected = selectedValueId === valId;
                const reachable = isReachable(slug, valId);
                const cls = isSelected
                  ? "border-terracotta bg-terracotta text-canvas"
                  : reachable
                  ? "border-[#bfa888] bg-card text-ink hover:border-[#6b4f37] hover:text-terracotta"
                  : "border-stone-taupe/20 bg-muted text-muted-foreground/60 line-through";
                const label = valuesById[valId]?.value ?? valId;
                return (
                  <button
                    type="button"
                    key={valId}
                    onClick={() => pick(slug, valId)}
                    disabled={!reachable && !isSelected}
                    aria-pressed={isSelected}
                    className={
                      "px-3.5 py-1.5 rounded-lg border text-sm transition-colors " + cls
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
