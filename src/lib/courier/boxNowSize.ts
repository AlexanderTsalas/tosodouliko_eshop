/**
 * Phase 11 — cart → BoxNow parcel size bucket mapping.
 *
 * BoxNow accepts 3 parcel sizes per their public documentation:
 *
 *   1 (small)   — 45×35×18 cm, up to ~2 kg
 *   2 (medium)  — 45×35×36 cm, up to ~5 kg
 *   3 (large)   — 45×35×68 cm, up to ~10 kg
 *
 * Exact thresholds may vary per BoxNow contract — verify against the
 * sandbox before shipping. The mapping below is intentionally weight-only
 * because most line-item dimensions are unknown in this codebase; if a
 * future feature stores per-variant dimensions, extend the helper to
 * factor them in.
 *
 * Returns size 1 on missing/zero weight rather than throwing — a small
 * parcel is the safe default that won't overflow any BoxNow locker.
 */
export type BoxNowParcelSize = 1 | 2 | 3;

const SMALL_MAX_KG = 2;
const MEDIUM_MAX_KG = 5;

export function mapCartToBoxNowSize(totalWeightKg: number): BoxNowParcelSize {
  if (!Number.isFinite(totalWeightKg) || totalWeightKg <= 0) return 1;
  if (totalWeightKg <= SMALL_MAX_KG) return 1;
  if (totalWeightKg <= MEDIUM_MAX_KG) return 2;
  return 3;
}

/** Customer-facing label per size — used by admin order page + reports. */
export const BOX_NOW_SIZE_LABELS: Record<BoxNowParcelSize, string> = {
  1: "Small (≤2 kg)",
  2: "Medium (≤5 kg)",
  3: "Large (≤10 kg)",
};
