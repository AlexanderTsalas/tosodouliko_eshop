"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";

/** The selection snapshot captured when bulk mode opens. */
export interface BulkSelection {
  selectedIds: string[];
  matchAll: boolean;
  filterParams?: AdminProductFilterParams;
}

/** Scope captured when the "all variants" panel opens from the edge
 *  indicator. Mirrors what the products table currently shows. */
export interface AllVariantsScope {
  /** Explicitly-selected product ids (empty unless the admin ticked rows). */
  selectedIds: string[];
  matchAll: boolean;
  filterParams: AdminProductFilterParams;
}

/**
 * Client-side controller for the product side panel.
 *
 * Open state lives HERE, not in the URL — clicking a row flips local
 * state so the panel slides in instantly (no navigation, no server
 * round-trip on the force-dynamic list page). The panel fetches its own
 * content via the `getProductPanelData` server action once open.
 *
 * The URL is mirrored (`?focus=`, `?variant=`) via `history.replaceState`
 * purely for: row highlight on refresh, deep-link/refresh restore, and
 * shareable links. Because we use the native History API (Next 16 picks
 * it up in `useSearchParams`) rather than `router.push`, the list page's
 * server component does NOT re-render — the table query is never re-run
 * just to open the panel.
 */
export type PanelMode = "closed" | "detail" | "bulk" | "all-variants";

interface PanelControllerValue {
  mode: PanelMode;
  /** Product currently shown in detail mode (null in closed/bulk). */
  productId: string | null;
  /** Variant whose image group the Images tab should focus on, if any. */
  variantFocus: string | null;
  /** Selection snapshot for bulk mode (null otherwise). */
  bulkSelection: BulkSelection | null;
  /** Scope for all-variants mode (null otherwise). */
  allVariantsScope: AllVariantsScope | null;
  /** Tab to land on for the next detail open (null = default). Consumed by
   *  the panel's per-product tab reset. */
  initialTab: string | null;
  isOpen: boolean;
  /** Open the panel in single-product detail mode. `opts.tab` lands on a
   *  specific tab (e.g. "images" from a "+ add image" placeholder). */
  open: (productId: string, opts?: { tab?: string }) => void;
  /** Focus a variant's image group (product already open). */
  focusVariantImages: (variantId: string) => void;
  /** Open the panel in multi-product bulk-edit mode with a captured selection. */
  openBulk: (selection: BulkSelection) => void;
  /** Open the panel showing every variant of every in-scope product. */
  openAllVariants: (scope: AllVariantsScope) => void;
  close: () => void;
}

const Ctx = createContext<PanelControllerValue | null>(null);

export function usePanelController(): PanelControllerValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "usePanelController must be used inside <PanelControllerProvider>"
    );
  }
  return v;
}

/** Non-throwing variant — returns null outside a provider. For components
 *  (e.g. ProductThumbnailStack) reused on pages that have no panel. */
export function usePanelControllerOptional(): PanelControllerValue | null {
  return useContext(Ctx);
}

/** Rewrite the current query string with the given focus/variant, preserving
 *  everything else (selection, filters, pagination), then push it to the URL
 *  bar WITHOUT a Next navigation. */
function mirrorUrl(focus: string | null, variant: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (focus) params.set("focus", focus);
  else params.delete("focus");
  if (variant) params.set("variant", variant);
  else params.delete("variant");
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(window.history.state, "", url);
}

export default function PanelControllerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchParams = useSearchParams();

  // Restore from the URL on first mount (deep-link / refresh with ?focus=).
  // Lazy initializers run once, so later ?focus= mirroring via
  // history.replaceState doesn't re-seed these.
  const [mode, setMode] = useState<PanelMode>(() =>
    searchParams.get("focus") ? "detail" : "closed"
  );
  const [productId, setProductId] = useState<string | null>(() =>
    searchParams.get("focus")
  );
  const [variantFocus, setVariantFocus] = useState<string | null>(() =>
    searchParams.get("variant")
  );
  const [bulkSelection, setBulkSelection] = useState<BulkSelection | null>(null);
  const [allVariantsScope, setAllVariantsScope] =
    useState<AllVariantsScope | null>(null);
  const [initialTab, setInitialTab] = useState<string | null>(null);

  const open = useCallback((id: string, opts?: { tab?: string }) => {
    setMode("detail");
    setProductId(id);
    setVariantFocus(null);
    setBulkSelection(null);
    setAllVariantsScope(null);
    setInitialTab(opts?.tab ?? null);
    mirrorUrl(id, null);
  }, []);

  const focusVariantImages = useCallback(
    (variantId: string) => {
      setVariantFocus(variantId);
      mirrorUrl(productId, variantId);
    },
    [productId]
  );

  const openBulk = useCallback((selection: BulkSelection) => {
    setMode("bulk");
    setProductId(null);
    setVariantFocus(null);
    setBulkSelection(selection);
    setAllVariantsScope(null);
    setInitialTab(null);
    // Bulk mode isn't a single resource — keep it out of the URL.
    mirrorUrl(null, null);
  }, []);

  const openAllVariants = useCallback((scope: AllVariantsScope) => {
    setMode("all-variants");
    setProductId(null);
    setVariantFocus(null);
    setBulkSelection(null);
    setAllVariantsScope(scope);
    setInitialTab(null);
    // Not a single resource — keep it out of the URL.
    mirrorUrl(null, null);
  }, []);

  const close = useCallback(() => {
    setMode("closed");
    setProductId(null);
    setVariantFocus(null);
    setBulkSelection(null);
    setAllVariantsScope(null);
    setInitialTab(null);
    mirrorUrl(null, null);
  }, []);

  const value = useMemo<PanelControllerValue>(
    () => ({
      mode,
      productId,
      variantFocus,
      bulkSelection,
      allVariantsScope,
      initialTab,
      isOpen: mode !== "closed",
      open,
      focusVariantImages,
      openBulk,
      openAllVariants,
      close,
    }),
    [
      mode,
      productId,
      variantFocus,
      bulkSelection,
      allVariantsScope,
      initialTab,
      open,
      focusVariantImages,
      openBulk,
      openAllVariants,
      close,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
