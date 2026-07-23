import { comboKey } from "@/lib/variants-helpers";

/** Minimal variant shape needed to derive a product's axis matrix. */
export interface VariantComboRow {
  product_id: string;
  attribute_combo: Record<string, string> | null;
}

export interface BulkAxisPlan {
  /** productId → new combos to create (only products that gain something). */
  perProduct: Map<string, Array<Record<string, string>>>;
  /** valueId → number of products that will receive that value. */
  perValueProductCount: Record<string, number>;
  /** Total new combos across all products. */
  totalCombos: number;
  /** Number of products that gain at least one combo. */
  affectedProducts: number;
}

/**
 * Plan an additive bulk axis operation: "ensure attribute `attributeSlug`
 * has values `valueIds` on each product, applying only where missing".
 *
 * Per product:
 *   - existing axes are derived from its variants' attribute_combos;
 *   - values the product already has on this axis are skipped;
 *   - for each MISSING value, new combos = (cartesian of the product's
 *     OTHER axes) × that value, minus combos that already exist.
 *
 * Adding a value to an existing axis expands the matrix cleanly. Adding a
 * brand-new axis (product lacks it) expands every existing combo by the
 * new value(s); the product's pre-existing lower-dimensional combos are
 * left in place (same behaviour as the single-product axes manager).
 *
 * Pure — no IO. Both the preview and apply server actions use it so the
 * counts shown in the confirm modal match exactly what gets created.
 */
export function planBulkAxisAdditions(
  variants: VariantComboRow[],
  productIds: string[],
  attributeSlug: string,
  valueIds: string[]
): BulkAxisPlan {
  const byProduct = new Map<string, Array<Record<string, string>>>();
  for (const pid of productIds) byProduct.set(pid, []);
  for (const v of variants) {
    const list = byProduct.get(v.product_id);
    if (!list) continue;
    list.push(v.attribute_combo ?? {});
  }

  const perProduct = new Map<string, Array<Record<string, string>>>();
  const perValueProductCount: Record<string, number> = {};
  for (const vId of valueIds) perValueProductCount[vId] = 0;
  let totalCombos = 0;
  let affectedProducts = 0;

  for (const pid of productIds) {
    const combos = byProduct.get(pid) ?? [];

    // Derive axes: slug → set of value ids in use on this product.
    const axes = new Map<string, Set<string>>();
    for (const c of combos) {
      for (const [slug, val] of Object.entries(c)) {
        let set = axes.get(slug);
        if (!set) {
          set = new Set<string>();
          axes.set(slug, set);
        }
        set.add(val);
      }
    }

    const existingForAxis = axes.get(attributeSlug) ?? new Set<string>();
    const missingValues = valueIds.filter((v) => !existingForAxis.has(v));
    if (missingValues.length === 0) continue;

    // Cartesian of the product's OTHER axes.
    let base: Array<Record<string, string>> = [{}];
    for (const [slug, vals] of axes) {
      if (slug === attributeSlug) continue;
      const next: Array<Record<string, string>> = [];
      for (const b of base) {
        for (const val of vals) next.push({ ...b, [slug]: val });
      }
      base = next;
    }

    const existingKeys = new Set(combos.map((c) => comboKey(c)));
    const newCombos: Array<Record<string, string>> = [];
    // Track which values actually contribute a NEW combo for this product,
    // so the per-value product counts match what apply really creates
    // (a missing value whose every expansion already exists adds nothing).
    const valuesWithNewCombos = new Set<string>();
    for (const b of base) {
      for (const v of missingValues) {
        const combo = { ...b, [attributeSlug]: v };
        if (!existingKeys.has(comboKey(combo))) {
          newCombos.push(combo);
          valuesWithNewCombos.add(v);
        }
      }
    }
    if (newCombos.length === 0) continue;

    perProduct.set(pid, newCombos);
    affectedProducts++;
    totalCombos += newCombos.length;
    for (const v of valuesWithNewCombos) {
      perValueProductCount[v] = (perValueProductCount[v] ?? 0) + 1;
    }
  }

  return { perProduct, perValueProductCount, totalCombos, affectedProducts };
}
