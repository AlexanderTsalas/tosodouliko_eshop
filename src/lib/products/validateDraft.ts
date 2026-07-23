/**
 * Shared "is this draft ready to become a real product?" validator.
 *
 * Pure + isomorphic so the SAME rules gate both the server-side finalise
 * actions (createDraftProduct → finalise) and the panel footer's live
 * enable/disable of the "Create Product" CTA. Returns the list of MISSING
 * requirements as human labels (empty = ready). The order is the order
 * they should be surfaced to the admin.
 */

export interface DraftReadiness {
  name: string | null | undefined;
  baseSku: string | null | undefined;
  basePrice: number | null | undefined;
  variantCount: number;
}

export function missingForPublish(p: DraftReadiness): string[] {
  const missing: string[] = [];
  if (!p.name || !p.name.trim()) missing.push("Όνομα προϊόντος");
  if (!p.baseSku || !p.baseSku.trim()) missing.push("Base SKU");
  if (typeof p.basePrice !== "number" || !(p.basePrice > 0)) {
    missing.push("Τιμή μεγαλύτερη του 0");
  }
  if (p.variantCount < 1) missing.push("Τουλάχιστον μία παραλλαγή");
  return missing;
}

export function isReadyForPublish(p: DraftReadiness): boolean {
  return missingForPublish(p).length === 0;
}
