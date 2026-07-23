/**
 * Selection-strategy ranker. Given a candidate set + the association's
 * strategy + manual picks, return the ordered top-N product ids that
 * should appear in the carousel.
 */

import type {
  RelatedProductsSelectionStrategy,
  RelatedProductsManualPick,
} from "@/types/related-products";
import type { ResolverProductData } from "./types";

export function rankAndTake(
  candidates: string[],
  strategy: RelatedProductsSelectionStrategy,
  maxResults: number,
  productsById: Map<string, ResolverProductData>,
  manualPicks: RelatedProductsManualPick[]
): string[] {
  switch (strategy) {
    case "random":
      return shuffle([...candidates]).slice(0, maxResults);

    case "recent": {
      // Most-recently-created first. Products without a created_at
      // (theoretically impossible) fall to the end.
      const sorted = [...candidates].sort((a, b) => {
        const ca = productsById.get(a)?.created_at ?? "";
        const cb = productsById.get(b)?.created_at ?? "";
        return cb.localeCompare(ca);
      });
      return sorted.slice(0, maxResults);
    }

    case "manual": {
      // Use the manual pick order. Picks not in candidates (e.g. the
      // admin curated a product that no longer matches the target
      // filter) are silently skipped. Candidates not in picks are
      // appended afterwards (so admin always has at least picks-order
      // results, never fewer than they expect from active candidates).
      const candidateSet = new Set(candidates);
      const ordered = [...manualPicks]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((p) => p.product_id)
        .filter((id) => candidateSet.has(id));
      const remainingCandidates = candidates.filter(
        (id) => !ordered.includes(id)
      );
      return [...ordered, ...remainingCandidates].slice(0, maxResults);
    }
  }
}

// Fisher-Yates shuffle (in-place); used by random strategy.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
