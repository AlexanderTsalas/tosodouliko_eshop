/**
 * Natural sort for attribute values.
 *
 * Why a content-aware sort instead of plain display_order:
 *   - Sizes like "16", "17", "18", "19", "20", "21"… should sort
 *     numerically. Plain string compare puts "10" before "2".
 *   - Mixed values like "S", "M", "L", "XL" should sort alphabetically
 *     (and locale-aware: Greek letters compare via collator).
 *   - The previous sort by display_order made admins reorder values
 *     manually for every new attribute they created — wasted effort,
 *     and broke whenever they added a new value mid-range.
 *
 * Strategy: extract a leading number from each value (e.g. "16",
 * "16cm", "16 ευρώ" all match 16). If BOTH values being compared are
 * numeric, numeric-compare. Otherwise fall through to a Greek-aware
 * locale string compare.
 */
const LEADING_NUMBER = /^-?\d+(?:[.,]\d+)?/;

function parseLeadingNumber(s: string): number | null {
  const trimmed = s.trim();
  const match = LEADING_NUMBER.exec(trimmed);
  if (!match) return null;
  // Replace comma decimal separators (Greek style) with dots before parseFloat.
  const n = parseFloat(match[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const collator = new Intl.Collator("el-GR", {
  numeric: true,
  sensitivity: "base",
});

/** Comparator for an array of AttributeValue-like objects. */
export function compareAttributeValues<
  T extends { value: string },
>(a: T, b: T): number {
  const aNum = parseLeadingNumber(a.value);
  const bNum = parseLeadingNumber(b.value);
  if (aNum !== null && bNum !== null) {
    // Pure numeric ordering: ascending. Tie-breaker on the suffix text
    // so "16cm" and "16in" don't compare equal (they'd otherwise be
    // swappable mid-list, which looks visually unstable).
    if (aNum !== bNum) return aNum - bNum;
    return collator.compare(a.value, b.value);
  }
  return collator.compare(a.value, b.value);
}

/** Sort in place via the content-aware comparator. */
export function sortAttributeValues<T extends { value: string }>(arr: T[]): T[] {
  return arr.sort(compareAttributeValues);
}
