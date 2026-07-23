"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import {
  loadResolverData,
  buildViewerFromProduct,
  resolveRelatedProducts,
  type ResolverResult,
} from "@/lib/related-products";

const Schema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  /** When set, the resolver is scoped to just this one association and
   *  its `active` flag is treated as `true` for the test run. Lets the
   *  per-relationship "Τέστ Live Προτεινόμενων" tool preview what a
   *  single (possibly inactive) association would produce on its own,
   *  without interference from other associations. */
  only_association_id: z.string().uuid().nullable().optional(),
});

/**
 * Admin debug entry point. Two modes:
 *   - No `only_association_id` → runs every active association against
 *     the viewer; mirrors the storefront resolver exactly.
 *   - `only_association_id` set → narrows the resolver dataset to just
 *     that one association (and forces it active for the test) so the
 *     admin can preview a single relationship in isolation.
 *
 * Returns carousels AND any warnings the engine produced
 * (bidirectional overlaps, etc).
 *
 * Gated by `manage:products`.
 */
export async function debugResolveCarousels(
  input: z.input<typeof Schema>
): Promise<Result<ResolverResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ResolverResult>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ResolverResult>("Forbidden", "FORBIDDEN");
  }

  try {
    const dataset = await loadResolverData();
    const viewer = buildViewerFromProduct(dataset, {
      product_id: parsed.data.product_id,
      variant_id: parsed.data.variant_id ?? null,
    });
    if (!viewer) {
      return fail<ResolverResult>(
        "Το προϊόν δεν βρέθηκε ή δεν είναι ενεργό.",
        "PRODUCT_NOT_FOUND"
      );
    }

    // Per-relationship scope: narrow the dataset.associations to the
    // single requested row, and force it active so the resolver runs
    // it even if the admin is previewing an inactive draft.
    let scopedDataset = dataset;
    if (parsed.data.only_association_id) {
      const target = dataset.associations.find(
        (a) => a.id === parsed.data.only_association_id
      );
      if (!target) {
        return fail<ResolverResult>(
          "Δεν βρέθηκε η συγκεκριμένη συσχέτιση.",
          "ASSOCIATION_NOT_FOUND"
        );
      }
      scopedDataset = {
        ...dataset,
        associations: [{ ...target, active: true }],
      };
    }

    const result = resolveRelatedProducts({
      viewer,
      dataset: scopedDataset,
    });
    return ok(result);
  } catch (e) {
    return fail<ResolverResult>(
      "Engine error: " + (e instanceof Error ? e.message : String(e)),
      "ENGINE_ERROR"
    );
  }
}
