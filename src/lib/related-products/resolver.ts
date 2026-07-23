/**
 * Storefront resolver — the engine that turns a viewer (product page
 * context) + the association library into up to 3 ranked carousels.
 *
 * Pure function — no DB I/O. The caller pre-loads data via
 * `loadResolverData` and passes it in. This makes the resolver
 * trivially testable and means a single fetch can answer many viewer
 * queries (e.g., a debug tool that previews several products).
 *
 * Pipeline per association (sorted by display_order ASC; 1 = topmost):
 *   1. Skip if inactive.
 *   2. Try the SOURCE → TARGET direction:
 *        - Does the viewer match the source filter?
 *        - If yes: resolve target candidates and proceed to step 4.
 *   3. If bidirectional is true AND step 2 didn't match, try the REVERSE
 *      direction:
 *        - Does the viewer match the TARGET filter?
 *        - If yes: resolve SOURCE candidates and proceed to step 4 with
 *          the source-side filter as the candidate filter.
 *   4. Subtract viewer's own product (self-exclusion, always on).
 *   5. Subtract OOS if exclude_oos = true.
 *   6. Apply selection strategy → take top max_results.
 *   7. Emit carousel.
 *
 * Bidirectional overlap policy:
 *   When bidirectional is true and BOTH sides match the viewer (rare —
 *   needs overlapping source/target filters), the engine keeps the
 *   forward direction and emits a `bidirectional_overlap` warning. The
 *   admin "Test Προτεινόμενων" drawer surfaces these warnings so the
 *   merchant can tighten the filters or disable the flag.
 *
 * Hard cap: at most 3 carousels per page. Excess (anything past the
 * top-3 by display_order) is dropped silently.
 */

import { viewerMatchesSide } from "./matchSide";
import { resolveTargetCandidates } from "./resolveTarget";
import { rankAndTake } from "./applyStrategy";
import type {
  ResolverViewer,
  ResolverDataset,
  ResolverProductData,
  ResolvedCarousel,
  ResolverResult,
  ResolverWarning,
} from "./types";

const HARD_CAROUSEL_CAP = 3;

export function resolveRelatedProducts(args: {
  viewer: ResolverViewer;
  dataset: ResolverDataset;
}): ResolverResult {
  const { viewer, dataset } = args;
  const carousels: ResolvedCarousel[] = [];
  const warnings: ResolverWarning[] = [];

  // Active associations by display_order ASC (1 = topmost), with
  // created_at DESC as a stable tiebreaker so order is deterministic
  // across requests.
  const ordered = [...dataset.associations]
    .filter((a) => a.active)
    .sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return b.created_at.localeCompare(a.created_at);
    });

  for (const assoc of ordered) {
    if (carousels.length >= HARD_CAROUSEL_CAP) break;

    const sourceMatches = viewerMatchesSide(
      viewer,
      assoc.source_groups,
      dataset.productsById
    );
    const targetMatches =
      assoc.bidirectional &&
      viewerMatchesSide(viewer, assoc.target_groups, dataset.productsById);

    let direction: "forward" | "reverse" | null = null;
    let candidateGroups = assoc.target_groups;

    if (sourceMatches) {
      direction = "forward";
      candidateGroups = assoc.target_groups;
      if (targetMatches) {
        // Both sides matched the same viewer. Keep the forward direction
        // (policy) and surface a warning so the admin can clean it up.
        warnings.push({
          kind: "bidirectional_overlap",
          association_id: assoc.id,
          association_name: assoc.name,
          kept_direction: "forward",
        });
      }
    } else if (targetMatches) {
      direction = "reverse";
      candidateGroups = assoc.source_groups;
    }

    if (!direction) continue;

    let candidates = resolveTargetCandidates(
      candidateGroups,
      dataset.productsList
    );

    // Self-exclusion (always on)
    candidates = candidates.filter((id) => id !== viewer.product_id);

    // OOS exclusion if configured
    if (assoc.exclude_oos) {
      candidates = candidates.filter((id) =>
        productHasStock(dataset.productsById.get(id))
      );
    }

    if (candidates.length === 0) continue;

    const top = rankAndTake(
      candidates,
      assoc.selection_strategy,
      assoc.max_results,
      dataset.productsById,
      assoc.manual_picks
    );

    if (top.length === 0) continue;

    carousels.push({
      association_id: assoc.id,
      title_translations: assoc.message_title_translations,
      card_granularity: assoc.card_granularity,
      display_order: assoc.display_order,
      selection_strategy: assoc.selection_strategy,
      products: top.map((id) => {
        const p = dataset.productsById.get(id);
        return { id, name: p?.name ?? id };
      }),
      matched_by: describeMatch(assoc, direction),
      direction,
    });
  }

  return { carousels, warnings };
}

function productHasStock(product: ResolverProductData | undefined): boolean {
  if (!product) return false;
  return product.variants.some((v) => v.quantity_available > 0);
}

function describeMatch(
  association: ResolverDataset["associations"][number],
  direction: "forward" | "reverse"
): string {
  const sourceConds = association.source_groups.flatMap((g) =>
    g.conditions.map((c) => c.kind)
  );
  const tag = direction === "reverse" ? " · αντίστροφα" : "";
  if (sourceConds.length === 0) return association.name + tag;
  return `${association.name} (πηγή: ${sourceConds.join(", ")})${tag}`;
}
