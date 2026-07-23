/**
 * URL-encoding helpers for bulk-selection state across admin list pages.
 *
 * Two selection modes, mutually exclusive:
 *
 *   - Explicit IDs:   ?selected=a,b,c   (capped at 50 to stay under URL limits)
 *   - Match-all:      ?matchAll=1       (the current filter resolves to the set)
 *
 * The bulk-edit route resolves both forms into a concrete ID list before
 * applying any changes, then enforces the 500-product hard cap.
 */

export const MAX_EXPLICIT_SELECTION = 50;
export const MAX_BULK_OPERATION = 500;

export interface SelectionState {
  /** Explicit selected IDs (parsed). Empty array when matchAll mode is on. */
  selectedIds: string[];
  /** True when the user clicked "Select all N matching" — the filter defines the set. */
  matchAll: boolean;
}

export function parseSelection(searchParams: {
  selected?: string;
  matchAll?: string;
}): SelectionState {
  if (searchParams.matchAll === "1") {
    return { selectedIds: [], matchAll: true };
  }
  const raw = searchParams.selected?.trim();
  if (!raw) return { selectedIds: [], matchAll: false };
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return { selectedIds: ids, matchAll: false };
}

/** Produces the URL for toggling one row's selection on the current page. */
export function toggleSelectionHref(
  currentParams: URLSearchParams,
  id: string,
  currentlySelected: boolean
): string {
  const next = new URLSearchParams(currentParams);
  next.delete("matchAll"); // single-row toggle drops match-all mode
  const current = (next.get("selected") ?? "").split(",").filter(Boolean);
  const set = new Set(current);
  if (currentlySelected) set.delete(id);
  else set.add(id);
  if (set.size === 0) next.delete("selected");
  else next.set("selected", Array.from(set).join(","));
  return `?${next.toString()}`;
}

/** Adds all of `ids` to the explicit selection set (no matchAll). */
export function selectAllOnPageHref(
  currentParams: URLSearchParams,
  ids: string[]
): string {
  const next = new URLSearchParams(currentParams);
  next.delete("matchAll");
  const current = (next.get("selected") ?? "").split(",").filter(Boolean);
  const set = new Set([...current, ...ids]);
  if (set.size === 0) next.delete("selected");
  else next.set("selected", Array.from(set).slice(0, MAX_EXPLICIT_SELECTION).join(","));
  return `?${next.toString()}`;
}

/** Switches to matchAll mode (clears explicit IDs). */
export function selectAllMatchingHref(currentParams: URLSearchParams): string {
  const next = new URLSearchParams(currentParams);
  next.delete("selected");
  next.set("matchAll", "1");
  return `?${next.toString()}`;
}

/** Clears all selection state. */
export function clearSelectionHref(currentParams: URLSearchParams): string {
  const next = new URLSearchParams(currentParams);
  next.delete("selected");
  next.delete("matchAll");
  return `?${next.toString()}`;
}
