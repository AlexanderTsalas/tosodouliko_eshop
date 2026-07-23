"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  X,
  ImageIcon,
  ChevronRight,
  Trash,
  Info,
  Layers,
  ClipboardList,
  Sparkles,
  SearchIcon,
} from "@/components/admin/common/icons";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import Toggle from "@/components/admin/common/Toggle";
import { updateVariant } from "@/actions/variants/updateVariant";
import { deleteVariant } from "@/actions/variants/deleteVariant";
import { setInventoryLevel } from "@/actions/inventory/setInventoryLevel";
import { getVariantInventoryLevels } from "@/actions/variants/getVariantInventoryLevels";
import { addMatrixCombos } from "@/actions/variants/addMatrixCombos";
import { updateProduct } from "@/actions/products/updateProduct";
import {
  useDebouncedSave,
  type DebouncedFieldHandle,
  type FieldState,
} from "@/hooks/useDebouncedSave";
import PanelAxesManager, {
  type PendingAxis,
} from "@/components/admin/products/PanelAxesManager";
import ProductSpecsPanel from "@/components/admin/products/ProductSpecsPanel";
import ProductThumbnailStack from "@/components/admin/products/ProductThumbnailStack";
import ProductOverviewTab from "@/components/admin/products/ProductOverviewTab";
import ProductImagesComboTab from "@/components/admin/products/images/ProductImagesComboTab";
import CustomFieldsTabPanel from "@/components/admin/products/panel-tabs/CustomFieldsTabPanel";
import RelatedTabPanel from "@/components/admin/products/panel-tabs/RelatedTabPanel";
import SeoTabPanel from "@/components/admin/products/panel-tabs/SeoTabPanel";
import VariantMorePanel from "@/components/admin/products/panel-tabs/VariantMorePanel";
import VariantSeoTabPanel from "@/components/admin/products/panel-tabs/VariantSeoTabPanel";
import BulkEditPanel from "@/components/admin/products/panel-tabs/BulkEditPanel";
import {
  usePanelController,
  type AllVariantsScope,
} from "@/components/admin/products/PanelControllerContext";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";
import { useSelection } from "@/components/admin/common/SelectionContext";
import { getProductPanelData } from "@/actions/products/getProductPanelData";
import {
  finalizeDraftProduct,
  finalizeDraftProducts,
} from "@/actions/products/finalizeDrafts";
import { missingForPublish } from "@/lib/products/validateDraft";
import {
  getAllVariantsData,
  type AllVariantsResult,
} from "@/actions/products/getAllVariantsData";
import type { ProductPanelBundle } from "@/types/product-panel";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";
import { comboKey } from "@/lib/variants-helpers";
import { comboToKey } from "@/components/admin/products/images/ImageGroupList";
import type { ProductImage } from "@/types/products";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

const PANEL_WIDTH_KEY = "admin-products-panel-width";
const PANEL_DEFAULT_WIDTH = 520;
const PANEL_MIN_WIDTH = 400;
/** Cap relative to viewport so a giant panel can't swallow the whole screen. */
const PANEL_MAX_WIDTH_FRACTION = 0.85;

/** Static tab order, used for Shift+↑/↓ tab navigation. Ephemeral variant-SEO
 *  tabs are appended after these at runtime. */
const PANEL_TAB_ORDER = [
  "overview",
  "variants",
  "images",
  "custom-fields",
  "related",
  "seo",
];

interface VariantRow {
  variant_id: string;
  sku: string | null;
  attribute_combo: Record<string, string> | null;
  price: number;
  active: boolean;
  quantity_available: number;
  quantity_reserved: number;
  quantity_soft_held: number;
  quantity_priority_held: number;
  low_stock_threshold: number;
  stock_status: "ok" | "low" | "out" | "untracked";
}

/** Variant fields eligible for inline bulk propagation across selected
 *  variants. SKU is intentionally excluded (unique per product). */
type VariantPropagateKind =
  | "price"
  | "active"
  | "available"
  | "threshold"
  | "reserved";

export interface ProductPanelData {
  product: {
    id: string;
    name: string;
    base_sku: string | null;
    slug: string;
    currency: string;
    base_price: number;
    active: boolean;
    /** TRUE = an unfinalised inline draft — drives the panel's Create footer. */
    is_draft: boolean;
    /** Sparse override of attributes.splits_listing per attribute slug.
     *  Consumed by the per-axis split toggles in the axes manager. */
    split_overrides: Record<string, boolean> | null;
    /** Attribute slugs that drive image selection. Variants filter the
     *  product's image list against these axes to find their own
     *  thumbnails (shown in each variant card's header). */
    image_axes: string[];
  };
  variants: VariantRow[];
  /** slug → human name (e.g. "color" → "Χρώμα") */
  attributeNames: Record<string, string>;
  /** value id → { value, display_order, attribute_slug } */
  valuesById: Record<
    string,
    { value: string; display_order: number; attribute_slug: string }
  >;
  images: ProductImage[];
  /**
   * Full system catalog of attributes. The axes manager uses id/slug/name;
   * the card-split rules section consumes the full Attribute (needs
   * splits_listing). Stored as Attribute[] so both consumers are happy.
   */
  allAttributes: Attribute[];
  /**
   * Full system catalog of attribute values. The axes manager uses
   * id/attribute_id/value/display_order; ProductImagesComboTab consumes
   * the full AttributeValue type (needs slug/price_modifier/created_at).
   */
  allAttributeValues: AttributeValue[];
}

const STATUS_BADGE: Record<
  VariantRow["stock_status"],
  { label: string; className: string }
> = {
  ok: {
    label: "Διαθέσιμο",
    className: "bg-emerald-50 border-emerald-200 text-emerald-700",
  },
  low: {
    label: "Χαμηλό",
    className: "bg-amber-50 border-amber-200 text-amber-700",
  },
  out: {
    label: "Άδειο",
    className: "bg-red-50 border-red-200 text-red-700",
  },
  untracked: {
    label: "Χωρίς παρακολούθηση",
    className: "bg-stone-100 border-stone-200 text-stone-600",
  },
};

/**
 * Right-side slide-in detail panel for a product.
 *
 * Open state is owned by PanelControllerContext (client state) — the
 * panel slides in the INSTANT a row is clicked (no navigation, no
 * server round-trip on the list page), then fetches its own content via
 * the `getProductPanelData` server action and fades it in. The `?focus=`
 * URL param is mirrored by the controller for highlight/refresh/share
 * only; it does not gate the open.
 *
 * After close, the last content lingers ~300ms so the body doesn't blank
 * out mid slide-out.
 */
export default function ProductDetailPanel({
  filterParams,
  pageProductIds,
}: {
  filterParams: AdminProductFilterParams;
  /** Product ids in table order — drives prev/next navigation in detail mode. */
  pageProductIds: string[];
}) {
  const {
    mode,
    productId,
    variantFocus,
    bulkSelection,
    allVariantsScope,
    initialTab,
    isOpen,
    open,
    close,
    focusVariantImages,
    openAllVariants,
  } = usePanelController();
  const { selectedIds, matchAll } = useSelection();
  const router = useRouter();

  // ── Content fetch (race-guarded) ──────────────────────────────────
  const [bundle, setBundle] = useState<ProductPanelBundle | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const reqToken = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (mode !== "detail" || !productId) return;
    const myToken = ++reqToken.current;
    setFetchError(null);
    // NOTE: variantFocus is intentionally NOT a dependency and not passed
    // here — the variant→image jump only needs the image-group key, which
    // PanelContent derives client-side from the already-fetched data. So a
    // jump just switches the tab + recomputes the key, no full refetch.
    getProductPanelData(productId)
      .then((res) => {
        if (myToken !== reqToken.current) return;
        if (!res) {
          setBundle(null);
          setFetchError("Το προϊόν δεν βρέθηκε.");
          return;
        }
        setBundle(res);
      })
      .catch(() => {
        if (myToken !== reqToken.current) return;
        setBundle(null);
        setFetchError("Σφάλμα φόρτωσης του προϊόντος.");
      });
  }, [mode, productId, reloadNonce]);

  // Re-fetch panel content after an in-panel mutation (add/delete variant,
  // etc.) AND refresh the underlying table rows. Replaces the old
  // router.refresh()-only flow, which no longer reaches the now
  // client-fetched panel data.
  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1);
    router.refresh();
  }, [router]);

  // Bundle that matches the product currently being viewed — guards
  // against a stale bundle from the previous product showing for a frame
  // during a switch.
  const activeBundle =
    mode === "detail" &&
    bundle &&
    productId &&
    bundle.panelData.product.id === productId
      ? bundle
      : null;
  const isLoading =
    mode === "detail" && !!productId && !activeBundle && !fetchError;

  // Keep the last content visible through the 300ms slide-out.
  const [display, setDisplay] = useState<ProductPanelBundle | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (activeBundle) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setDisplay(activeBundle);
    } else if (!isOpen) {
      closeTimer.current = setTimeout(() => setDisplay(null), 300);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [activeBundle, isOpen]);

  // ── Tab state ─────────────────────────────────────────────────────
  // `tab` is a string so it can hold an ephemeral variant-SEO tab id
  // ("vseo:<variantId>") alongside the static tab keys.
  // Opens on "variants" — clicking a product row lands the admin straight
  // on the variant editor (the most-used surface), not the overview.
  const [tab, setTab] = useState<string>("variants");
  // Ephemeral, closeable variant-SEO tabs opened from variant cards.
  const [seoTabs, setSeoTabs] = useState<
    { variantId: string; label: string }[]
  >([]);

  // Ordered tab keys (static + ephemeral SEO tabs) for Shift+↑/↓ navigation.
  const allTabKeys = useMemo(
    () => [...PANEL_TAB_ORDER, ...seoTabs.map((t) => `vseo:${t.variantId}`)],
    [seoTabs]
  );

  // Reset tabs when switching products → the requested initial tab, else
  // the variants tab (the most-used surface).
  useEffect(() => {
    if (mode === "detail" && productId) {
      setTab(initialTab ?? "variants");
      setSeoTabs([]);
    }
  }, [productId, mode, initialTab]);

  // Once the bundle reveals draft status, land DRAFTS on Overview (basic
  // info is needed before variants). Runs once per product; an explicit
  // initialTab (e.g. Shift+A → overview) takes precedence.
  const seededTabProductRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "detail") {
      seededTabProductRef.current = null;
      return;
    }
    if (!activeBundle) return;
    const pid = activeBundle.panelData.product.id;
    if (seededTabProductRef.current === pid) return;
    seededTabProductRef.current = pid;
    if (!initialTab && activeBundle.panelData.product.is_draft) {
      setTab("overview");
    }
  }, [activeBundle, mode, initialTab]);
  // Variant→image jump forces the Images tab.
  useEffect(() => {
    if (variantFocus) setTab("images");
  }, [variantFocus]);

  const openVariantSeo = useCallback((variantId: string, label: string) => {
    setSeoTabs((cur) =>
      cur.some((t) => t.variantId === variantId)
        ? cur
        : [...cur, { variantId, label }]
    );
    setTab(`vseo:${variantId}`);
  }, []);

  const closeSeoTab = useCallback((variantId: string) => {
    setSeoTabs((cur) => cur.filter((t) => t.variantId !== variantId));
    setTab((cur) => (cur === `vseo:${variantId}` ? "variants" : cur));
  }, []);

  // ── Width (persisted, drag-resizable) ─────────────────────────────
  const [width, setWidth] = useState<number>(PANEL_DEFAULT_WIDTH);
  const widthRef = useRef<number>(PANEL_DEFAULT_WIDTH);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  // Mirror the drag state in React state purely for the handle's visual
  // (reading dragState.current during render isn't allowed).
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (!stored) return;
    const n = Number(stored);
    if (!Number.isFinite(n)) return;
    const max = window.innerWidth * PANEL_MAX_WIDTH_FRACTION;
    const clamped = Math.max(PANEL_MIN_WIDTH, Math.min(max, n));
    widthRef.current = clamped;
    setWidth(clamped);
  }, []);

  // ESC closes the panel.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // ── Prev/next product navigation (detail mode) ────────────────────
  // Walks the product order currently shown in the table. Disabled at the
  // page boundaries (doesn't cross pagination).
  const detailIndex =
    mode === "detail" && productId ? pageProductIds.indexOf(productId) : -1;
  const prevProductId = detailIndex > 0 ? pageProductIds[detailIndex - 1] : null;
  const nextProductId =
    detailIndex >= 0 && detailIndex < pageProductIds.length - 1
      ? pageProductIds[detailIndex + 1]
      : null;

  const goPrev = useCallback(() => {
    if (prevProductId) open(prevProductId);
  }, [prevProductId, open]);
  const goNext = useCallback(() => {
    if (nextProductId) open(nextProductId);
  }, [nextProductId, open]);

  // Keyboard nav while a product is open (detail mode). Ignored when a form
  // field has focus so it never hijacks text selection / caret movement.
  //   Shift+← / Shift+→  → previous / next product
  //   Shift+↑ / Shift+↓  → previous / next tab
  useEffect(() => {
    if (mode !== "detail") return;
    function onKey(e: KeyboardEvent) {
      if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft" && prevProductId) {
        e.preventDefault();
        open(prevProductId);
      } else if (e.key === "ArrowRight" && nextProductId) {
        e.preventDefault();
        open(nextProductId);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const idx = allTabKeys.indexOf(tab);
        if (idx === -1) return;
        const nextIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
        if (nextIdx >= 0 && nextIdx < allTabKeys.length) {
          e.preventDefault();
          setTab(allTabKeys[nextIdx]);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, prevProductId, nextProductId, open, tab, allTabKeys]);

  // Resize drag — the handle on the panel's LEFT edge. Dragging left
  // widens the panel. Ref-mirrored width lets pointermove read the latest
  // start value without waiting on a committed render.
  // Open the all-variants view from the edge indicator. Scope mirrors the
  // table: explicit selection wins; otherwise the current filters drive it.
  const openAllVariantsFromIndicator = useCallback(() => {
    openAllVariants({ selectedIds, matchAll, filterParams });
  }, [openAllVariants, selectedIds, matchAll, filterParams]);

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // While closed the tab is an "open all variants" button, not a resize
    // handle — there's nothing to resize. Let the click handler take over.
    if (!isOpen) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startWidth: widthRef.current };
    setDragging(true);
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const delta = dragState.current.startX - e.clientX;
    const max = window.innerWidth * PANEL_MAX_WIDTH_FRACTION;
    const next = Math.max(
      PANEL_MIN_WIDTH,
      Math.min(max, dragState.current.startWidth + delta)
    );
    widthRef.current = next;
    setWidth(next);
  }

  function onHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragState.current = null;
    setDragging(false);
    localStorage.setItem(PANEL_WIDTH_KEY, String(widthRef.current));
  }

  return (
    <>
      {/* Backdrop — fades in when open. Click closes. */}
      <button
        type="button"
        aria-label="Κλείσιμο"
        onClick={close}
        className={`
          fixed inset-0 z-[55]
          bg-foreground/20 backdrop-blur-[2px]
          transition-opacity duration-300
          ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}
        `}
        tabIndex={isOpen ? 0 : -1}
      />

      {/* Panel — slides from right. z-[60] keeps it above the backdrop
          and the bottom dock. Only transform animates so the drag stays
          smooth and doesn't fight a width transition. */}
      <aside
        aria-hidden={!isOpen}
        style={{ width }}
        className={`
          fixed top-0 right-0 z-[60] h-full
          bg-card border-l border-foreground/10
          shadow-[0_0_60px_-12px_rgba(0,0,0,0.3)]
          transition-transform duration-300 ease-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
          flex flex-col
        `}
      >
        {/* Edge tab clipped to the panel's left edge. Dual-purpose:
            - panel OPEN  → drag-to-resize handle.
            - panel CLOSED → button that opens the all-variants view
              (the tab is all that pokes past the right edge while the
              panel is parked off-screen). */}
        <div
          role={isOpen ? "separator" : "button"}
          aria-orientation={isOpen ? "vertical" : undefined}
          aria-label={
            isOpen ? "Αλλαγή πλάτους πάνελ" : "Όλες οι παραλλαγές προϊόντων"
          }
          aria-valuenow={isOpen ? Math.round(width) : undefined}
          aria-valuemin={isOpen ? PANEL_MIN_WIDTH : undefined}
          title={isOpen ? undefined : "Όλες οι παραλλαγές των προϊόντων"}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onClick={isOpen ? undefined : openAllVariantsFromIndicator}
          className={`
            absolute top-0 left-0 h-full
            w-3 -translate-x-1/2
            ${isOpen ? "cursor-col-resize" : "cursor-pointer"}
            z-10
            touch-none
          `}
        >
          <div
            className={`
              absolute top-1/2 right-full -translate-y-1/2
              flex items-center justify-center
              h-14 w-5 rounded-l-md
              shadow-[0_2px_8px_-2px_rgba(0,0,0,0.35)]
              text-background
              transition-colors duration-150
              ${dragging ? "bg-terracotta" : "bg-foreground/80 hover:bg-foreground"}
            `}
            aria-hidden
          >
            <span className="flex items-center -space-x-1.5">
              <ChevronRight className="w-3 h-3 rotate-180" />
              <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {isLoading ? (
          <PanelLoadingState onClose={close} />
        ) : mode === "detail" && fetchError ? (
          <PanelErrorState
            message={fetchError}
            onRetry={reload}
            onClose={close}
          />
        ) : mode === "bulk" && bulkSelection ? (
          <BulkEditPanel selection={bulkSelection} onClose={close} />
        ) : mode === "all-variants" && allVariantsScope ? (
          <AllVariantsPanel
            scope={allVariantsScope}
            onClose={close}
            onOpenProduct={open}
          />
        ) : display ? (
          /* `content-reveal` fades the body in once data arrives after an
              optimistic open. Keyed by product id so the animation
              re-fires on each product switch. */
          <div
            key={display.panelData.product.id}
            className="content-reveal flex flex-col h-full"
          >
            <PanelContent
              data={display.panelData}
              overview={display.overview}
              images={display.images}
              specs={display.specs}
              variantFocus={variantFocus}
              tab={tab}
              onTabChange={setTab}
              onClose={close}
              onPrev={goPrev}
              onNext={goNext}
              hasPrev={!!prevProductId}
              hasNext={!!nextProductId}
              onFocusVariantImages={focusVariantImages}
              seoTabs={seoTabs}
              onOpenVariantSeo={openVariantSeo}
              onCloseSeoTab={closeSeoTab}
              reload={reload}
            />
          </div>
        ) : null}
      </aside>
    </>
  );
}

/* ── Panel content ─────────────────────────────────────────────────── */

function PanelContent({
  data,
  overview,
  images,
  specs,
  variantFocus,
  tab,
  onTabChange,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onFocusVariantImages,
  seoTabs,
  onOpenVariantSeo,
  onCloseSeoTab,
  reload,
}: {
  data: ProductPanelData;
  overview: ProductPanelBundle["overview"];
  images: ProductPanelBundle["images"];
  specs: ProductPanelBundle["specs"];
  variantFocus: string | null;
  tab: string;
  onTabChange: (t: string) => void;
  onClose: () => void;
  /** Navigate to the previous product in the table order. */
  onPrev: () => void;
  /** Navigate to the next product in the table order. */
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onFocusVariantImages: (variantId: string) => void;
  seoTabs: { variantId: string; label: string }[];
  onOpenVariantSeo: (variantId: string, label: string) => void;
  onCloseSeoTab: (variantId: string) => void;
  reload: () => void;
}) {
  const { product } = data;
  const activeSeoTab = tab.startsWith("vseo:")
    ? seoTabs.find((t) => `vseo:${t.variantId}` === tab) ?? null
    : null;
  // Image-group key for a variant→image jump, derived client-side from
  // the already-fetched data (no server refetch). Mirrors the server's
  // restrict-to-image-axes + comboToKey. Falls back to the bundle's key
  // (e.g. a deep-link that didn't carry a variant focus).
  const imagesInitialKey = useMemo(() => {
    if (!variantFocus) return images.initialSelectedKey;
    const v = data.variants.find((x) => x.variant_id === variantFocus);
    if (!v) return images.initialSelectedKey;
    const axes = new Set(data.product.image_axes ?? []);
    const restricted: Record<string, string> = {};
    for (const [slug, valueId] of Object.entries(v.attribute_combo ?? {})) {
      if (axes.has(slug)) restricted[slug] = valueId;
    }
    return comboToKey(restricted);
  }, [variantFocus, data.variants, data.product.image_axes, images.initialSelectedKey]);
  return (
    <>
      {/* Header — the product's visual anchor: thumbnails + name + status
          + price, on a subtle gradient that lifts it off the body. */}
      <header className="px-5 pt-4 pb-4 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.08] to-foreground/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            {/* Same overlapping thumbnail stack as the table row, scaled up
                a touch. Click opens the lightbox. */}
            <div className="shrink-0 w-[132px] h-[58px] mt-0.5">
              <div className="origin-top-left scale-[1.2]">
                <ProductThumbnailStack
                  images={data.images}
                  productName={product.name}
                  productId={product.id}
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground leading-tight truncate min-w-0">
                  {product.name}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${
                    product.active
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-stone-100 text-stone-500 border border-stone-200"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      product.active ? "bg-emerald-500" : "bg-stone-400"
                    }`}
                    aria-hidden
                  />
                  {product.active ? "Ενεργό" : "Ανενεργό"}
                </span>
              </div>
              <p className="font-mono text-[11px] text-muted-foreground mt-1 truncate">
                {product.base_sku ?? "—"} · {product.slug}
              </p>
              <p className="mt-2">
                <span className="inline-flex items-center rounded-md bg-foreground/[0.06] px-2 py-0.5 text-sm font-semibold text-foreground tabular-nums">
                  {formatCurrency(product.base_price, product.currency)}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 self-stretch">
            {/* Prev / next product — walks the table order. Disabled at the
                page edges. Keyboard: Shift+← / Shift+→. The shortcut caption
                sits OUTSIDE/below the icon box. */}
            <div
              className={`flex flex-col items-center gap-1 ${
                hasPrev ? "" : "opacity-30"
              }`}
            >
              <button
                type="button"
                onClick={onPrev}
                disabled={!hasPrev}
                aria-label="Προηγούμενο προϊόν"
                title="Προηγούμενο προϊόν"
                className="p-1.5 rounded-md border border-foreground/15 bg-background text-foreground/80 hover:bg-foreground/5 hover:border-foreground/30 hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:border-foreground/15"
              >
                <ChevronRight className="w-5 h-5 rotate-180" />
              </button>
              <span className="text-[10px] leading-none font-medium tracking-tight text-muted-foreground">
                Shift + Left
              </span>
            </div>
            <div
              className={`flex flex-col items-center gap-1 ${
                hasNext ? "" : "opacity-30"
              }`}
            >
              <button
                type="button"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Επόμενο προϊόν"
                title="Επόμενο προϊόν"
                className="p-1.5 rounded-md border border-foreground/15 bg-background text-foreground/80 hover:bg-foreground/5 hover:border-foreground/30 hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:border-foreground/15"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <span className="text-[10px] leading-none font-medium tracking-tight text-muted-foreground">
                Shift + Right
              </span>
            </div>
            <span className="w-px h-8 bg-foreground/10 mx-0.5" aria-hidden />
            {/* The panel IS the editor now — no link to a separate edit
                page (retired in Phase 3). */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Κλείσιμο"
              className="p-1.5 rounded-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs — horizontally scrollable so the wider set (incl. the
          ported edit-page tabs) doesn't overflow the panel width. */}
      <div className="px-5 border-b border-foreground/10 flex items-stretch gap-0 overflow-x-auto">
        <TabButton
          active={tab === "overview"}
          onClick={() => onTabChange("overview")}
          icon={<Info className="w-4 h-4" />}
        >
          Επισκόπηση
        </TabButton>
        <TabButton
          active={tab === "variants"}
          onClick={() => onTabChange("variants")}
          icon={<Layers className="w-4 h-4" />}
        >
          Παραλλαγές
          <span className="ml-1.5 text-xs text-muted-foreground">
            {data.variants.length}
          </span>
        </TabButton>
        <TabButton
          active={tab === "images"}
          onClick={() => onTabChange("images")}
          icon={<ImageIcon className="w-4 h-4" />}
        >
          Εικόνες
          <span className="ml-1.5 text-xs text-muted-foreground">
            {data.images.length}
          </span>
        </TabButton>
        <TabButton
          active={tab === "custom-fields"}
          onClick={() => onTabChange("custom-fields")}
          icon={<ClipboardList className="w-4 h-4" />}
        >
          Πεδία
        </TabButton>
        <TabButton
          active={tab === "related"}
          onClick={() => onTabChange("related")}
          icon={<Sparkles className="w-4 h-4" />}
        >
          Σχετικά
        </TabButton>
        <TabButton
          active={tab === "seo"}
          onClick={() => onTabChange("seo")}
          icon={<SearchIcon className="w-4 h-4" />}
        >
          SEO
        </TabButton>
        {/* Ephemeral, closeable variant-SEO tabs opened from variant cards. */}
        {seoTabs.map((t) => {
          const key = `vseo:${t.variantId}`;
          const active = tab === key;
          return (
            <span
              key={key}
              className={`inline-flex items-stretch shrink-0 whitespace-nowrap transition-colors ${
                active
                  ? "bg-foreground/10 text-foreground shadow-[inset_0_-2px_0_hsl(var(--foreground))]"
                  : "text-muted-foreground hover:bg-foreground/[0.06]"
              }`}
            >
              <button
                type="button"
                onClick={() => onTabChange(key)}
                className="inline-flex items-center gap-1 pl-3 pr-1 py-2.5 text-sm hover:text-foreground"
                title={`SEO: ${t.label}`}
              >
                <SearchIcon className="w-3.5 h-3.5" />
                <span className="font-mono">{t.label}</span>
              </button>
              <button
                type="button"
                onClick={() => onCloseSeoTab(t.variantId)}
                aria-label="Κλείσιμο καρτέλας SEO"
                className="pr-2 pl-0.5 py-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
      </div>

      {/* Scrollable body. Tab components render client-side from the
          data the panel fetched (overview/variants/images) or lazy-fetch
          their own data on first open (custom fields / related / SEO). */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === "overview" ? (
          <ProductOverviewTab {...overview} hideStatStrip onSaved={reload} />
        ) : tab === "variants" ? (
          <VariantsList
            data={data}
            specs={specs}
            onFocusVariantImages={onFocusVariantImages}
            onOpenVariantSeo={onOpenVariantSeo}
            reload={reload}
          />
        ) : tab === "images" ? (
          <ProductImagesComboTab
            key={`images-${variantFocus ?? "all"}`}
            mode="edit"
            {...images}
            initialSelectedKey={imagesInitialKey}
          />
        ) : tab === "custom-fields" ? (
          <CustomFieldsTabPanel
            productId={product.id}
            productName={product.name}
          />
        ) : tab === "related" ? (
          <RelatedTabPanel productId={product.id} productName={product.name} />
        ) : tab === "seo" ? (
          <SeoTabPanel productId={product.id} />
        ) : activeSeoTab ? (
          <VariantSeoTabPanel
            key={activeSeoTab.variantId}
            variantId={activeSeoTab.variantId}
            label={activeSeoTab.label}
          />
        ) : null}
      </div>

      {/* Draft footer — only while this product is an unfinalised draft.
          Finalised/real products autosave, so they need no footer. */}
      {product.is_draft && (
        <DraftFooter
          productId={product.id}
          name={product.name}
          baseSku={product.base_sku}
          basePrice={product.base_price}
          variantCount={data.variants.length}
          reload={reload}
        />
      )}
    </>
  );
}

/* ── Draft footer (Create Product / Create All Drafts) ────────────── */

function DraftFooter({
  productId,
  name,
  baseSku,
  basePrice,
  variantCount,
  reload,
}: {
  productId: string;
  name: string;
  baseSku: string | null;
  basePrice: number;
  variantCount: number;
  reload: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const missing = missingForPublish({ name, baseSku, basePrice, variantCount });
  const ready = missing.length === 0;

  function createThis() {
    setMessage(null);
    startTransition(async () => {
      const r = await finalizeDraftProduct(productId);
      if (r.success) reload();
      else setMessage(r.error);
    });
  }

  function createAll() {
    setMessage(null);
    startTransition(async () => {
      const r = await finalizeDraftProducts({ ids: null });
      if (!r.success) {
        setMessage(r.error);
        return;
      }
      const { finalized, failed } = r.data;
      setMessage(
        `Δημιουργήθηκαν ${finalized}${
          failed.length ? ` · ${failed.length} ατελή παρέμειναν πρόχειρα` : ""
        }.`
      );
      reload();
    });
  }

  return (
    <footer className="shrink-0 border-t border-foreground/10 bg-foreground/[0.02] px-5 py-3 space-y-2">
      {!ready && (
        <p className="text-[11px] text-muted-foreground">
          Για δημιουργία λείπουν:{" "}
          <span className="text-foreground/80 font-medium">
            {missing.join(" · ")}
          </span>
        </p>
      )}
      {message && (
        <p className="text-[11px] text-foreground/80">{message}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={createThis}
          disabled={!ready || isPending}
          title={ready ? undefined : `Λείπουν: ${missing.join(", ")}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm px-4 py-2.5 shadow-sm hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
        >
          <Sparkles className="w-4 h-4" />
          {isPending ? "Δημιουργία…" : "Δημιουργία προϊόντος"}
        </button>
        <button
          type="button"
          onClick={createAll}
          disabled={isPending}
          title="Δημιουργία όλων των έτοιμων πρόχειρων"
          className="inline-flex items-center justify-center rounded-lg border border-foreground/25 bg-background text-foreground/80 font-medium text-sm px-3.5 py-2.5 hover:bg-foreground/5 hover:text-foreground hover:border-foreground/40 transition disabled:opacity-40"
        >
          Δημιουργία όλων
        </button>
      </div>
    </footer>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Distinctive tab glyph, rendered left of the label. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-3.5 py-2.5 text-sm shrink-0 whitespace-nowrap
        inline-flex items-center gap-1.5 transition-colors
        ${
          active
            ? "bg-foreground/10 text-foreground font-semibold shadow-[inset_0_-2px_0_hsl(var(--foreground))]"
            : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        }
      `}
    >
      {icon}
      {children}
    </button>
  );
}


/* ── Variants tab ──────────────────────────────────────────────────── */

function VariantsList({
  data,
  specs,
  onFocusVariantImages,
  onOpenVariantSeo,
  reload,
}: {
  data: ProductPanelData;
  /** Product specifications (read-only spec sheet) shown below the variants. */
  specs: ProductPanelBundle["specs"];
  /** Focus a variant's image group (switches the panel to the Images tab). */
  onFocusVariantImages: (variantId: string) => void;
  /** Open an ephemeral variant-SEO tab in the panel tab bar. */
  onOpenVariantSeo: (variantId: string, label: string) => void;
  /** Re-fetch panel content + refresh the table after a mutation. */
  reload: () => void;
}) {
  // Attribute slugs already used as variant axes — the specs picker
  // excludes these so a spec can't duplicate a variant axis.
  const variantAttributeSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const v of data.variants) {
      if (!v.attribute_combo) continue;
      for (const slug of Object.keys(v.attribute_combo)) set.add(slug);
    }
    return Array.from(set);
  }, [data.variants]);
  // State owned at this level so the axes manager + the preview-card
  // section see the same staging.
  const [pendingAxes, setPendingAxes] = useState<PendingAxis[]>([]);
  const [extraValuesByAxis, setExtraValuesByAxis] = useState<
    Record<string, string[]>
  >({});
  // Inverted selection model: track DESELECTED preview keys instead of
  // selected ones. Default behavior is "everything will be created" —
  // new combos appearing in `previewCombos` aren't in this set, so they
  // count as selected automatically. The user opts OUT by clicking
  // checkboxes to deselect.
  const [deselectedPreviewKeys, setDeselectedPreviewKeys] = useState<
    Set<string>
  >(new Set());
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isCommitting, startCommit] = useTransition();

  // ── Variant multi-select + inline propagation ─────────────────────
  // Selecting >1 variant and inline-editing a field on one offers to
  // propagate the committed value to the others (confirm modal counts
  // them). SKU is excluded (unique per product). Reuses the shared
  // BulkPropagation confirm modal.
  const { confirmPropagate } = useBulkPropagation();
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(
    new Set()
  );
  function toggleVariantSelected(id: string) {
    setSelectedVariantIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function propagateVariantField(
    sourceId: string,
    kind: VariantPropagateKind,
    value: number | boolean
  ) {
    if (!selectedVariantIds.has(sourceId) || selectedVariantIds.size < 2) return;
    // Targets = the OTHER selected variants (the source already saved via
    // its own field).
    const targets = data.variants.filter(
      (v) => v.variant_id !== sourceId && selectedVariantIds.has(v.variant_id)
    );
    if (targets.length === 0) return;
    const labels: Record<VariantPropagateKind, string> = {
      price: "την τιμή",
      active: "την κατάσταση (ενεργό)",
      available: "το διαθέσιμο απόθεμα",
      threshold: "το όριο χαμηλού αποθέματος",
      reserved: "τα δεσμευμένα",
    };
    await confirmPropagate({
      count: selectedVariantIds.size,
      message: labels[kind],
      apply: async () => {
        // setInventoryLevel always SETS quantity_available (the RPC does
        // not COALESCE it), so threshold/reserved propagation must pass
        // each target's CURRENT available — read fresh, not from the
        // possibly-stale panel snapshot — to avoid reverting a sibling's
        // just-edited stock.
        const needsAvailable = kind === "threshold" || kind === "reserved";
        const freshAvailable = needsAvailable
          ? await getVariantInventoryLevels(targets.map((t) => t.variant_id))
          : {};
        let firstError: string | undefined;
        for (const t of targets) {
          let res: { success: boolean; error?: string };
          if (kind === "price") {
            res = await updateVariant({ id: t.variant_id, price: value as number });
          } else if (kind === "active") {
            res = await updateVariant({
              id: t.variant_id,
              isActive: value as boolean,
            });
          } else if (kind === "available") {
            res = await setInventoryLevel({
              variantId: t.variant_id,
              quantityAvailable: value as number,
            });
          } else if (kind === "threshold") {
            res = await setInventoryLevel({
              variantId: t.variant_id,
              quantityAvailable:
                freshAvailable[t.variant_id] ?? t.quantity_available,
              lowStockThreshold: value as number,
            });
          } else {
            res = await setInventoryLevel({
              variantId: t.variant_id,
              quantityAvailable:
                freshAvailable[t.variant_id] ?? t.quantity_available,
              reconcileReservedTo: value as number,
            });
          }
          if (!res.success && !firstError) {
            firstError = res.error;
          }
        }
        reload();
        return { success: !firstError, error: firstError };
      },
    });
  }

  // Per-product split overrides — local state with optimistic toggle.
  // The map is sparse: an attribute slug is present iff the admin has
  // explicitly set an override; absent slugs fall back to the attribute's
  // global splits_listing default inside AxisContainer.
  const [splitOverrides, setSplitOverrides] = useState<Record<string, boolean>>(
    data.product.split_overrides ?? {}
  );
  function handleSplitChange(slug: string, next: boolean) {
    const prev = splitOverrides;
    const updated = { ...prev, [slug]: next };
    // Optimistic update — the toggle flips instantly via its own
    // built-in optimistic state; we also update local map so the next
    // render reflects the change. On server failure we revert.
    setSplitOverrides(updated);
    void updateProduct({
      id: data.product.id,
      splitOverrides: updated,
    }).then((r) => {
      if (!r.success) {
        setSplitOverrides(prev);
      }
    });
  }

  // Variant→image jump: tell the controller to focus this variant's image
  // group. The panel switches to the Images tab and re-fetches its data
  // with the variant's combo key as initialSelectedKey.
  function jumpToImagesFor(variantId: string) {
    onFocusVariantImages(variantId);
  }

  // ── Compute axis matrix (committed + extras + pending) ────────────
  const committedAxes = useMemo(() => {
    const slugToValueIds = new Map<string, Set<string>>();
    for (const v of data.variants) {
      if (!v.attribute_combo) continue;
      for (const [slug, valueId] of Object.entries(v.attribute_combo)) {
        const set = slugToValueIds.get(slug) ?? new Set<string>();
        set.add(valueId);
        slugToValueIds.set(slug, set);
      }
    }
    type Axis = { slug: string; valueIds: string[] };
    const axes: Axis[] = [];
    for (const [slug, valueIds] of slugToValueIds) {
      const extras = (extraValuesByAxis[slug] ?? []).filter(
        (v) => !valueIds.has(v)
      );
      axes.push({ slug, valueIds: [...Array.from(valueIds), ...extras] });
    }
    return axes;
  }, [data.variants, extraValuesByAxis]);

  // Combined axes used to drive the Cartesian product. Pending axes
  // (entirely new dimensions) are appended after committed axes.
  const allAxes = useMemo(() => {
    return [
      ...committedAxes,
      ...pendingAxes.map((p) => ({
        slug: p.attributeSlug,
        valueIds: p.valueIds,
      })),
    ];
  }, [committedAxes, pendingAxes]);

  // ── Compute preview combos ────────────────────────────────────────
  // Cartesian product of allAxes minus existing variants. An axis with
  // zero values short-circuits to no combos (no point rendering an
  // incomplete dimension).
  const previewCombos = useMemo<Array<Record<string, string>>>(() => {
    if (allAxes.length === 0) return [];
    if (allAxes.some((a) => a.valueIds.length === 0)) return [];

    let combos: Array<Record<string, string>> = [{}];
    for (const axis of allAxes) {
      const next: Array<Record<string, string>> = [];
      for (const c of combos) {
        for (const vid of axis.valueIds) {
          next.push({ ...c, [axis.slug]: vid });
        }
      }
      combos = next;
    }

    // Filter out combos that already exist as variants.
    const existing = new Set(
      data.variants.map((v) => comboKey(v.attribute_combo ?? {}))
    );
    return combos.filter((c) => !existing.has(comboKey(c)));
  }, [allAxes, data.variants]);

  // ── Commit handlers ───────────────────────────────────────────────
  async function commit(combos: Array<Record<string, string>>) {
    if (combos.length === 0) return;
    setCommitError(null);
    startCommit(async () => {
      const r = await addMatrixCombos({
        productId: data.product.id,
        combos,
      });
      if (!r.success) {
        setCommitError(r.error);
        return;
      }
      // Clear staged values consumed by the commit. Imperfect: if the
      // user staged extras across multiple axes and only committed a
      // subset, this clears the staged keys for *all* axes that
      // appeared in committed combos. Acceptable for now — the canonical
      // source of truth (the new variants) flows back via router.refresh.
      const touchedSlugs = new Set<string>();
      for (const c of combos) for (const slug of Object.keys(c)) touchedSlugs.add(slug);
      setExtraValuesByAxis((cur) => {
        const next: Record<string, string[]> = { ...cur };
        for (const slug of touchedSlugs) delete next[slug];
        return next;
      });
      setPendingAxes((cur) =>
        cur.filter((p) => !touchedSlugs.has(p.attributeSlug))
      );
      // Clear deselections — after a successful commit, the canonical
      // truth comes from the server. The pruning useEffect below also
      // drops stale entries for combos that no longer exist.
      setDeselectedPreviewKeys(new Set());
      reload();
    });
  }

  function handleCommitSingle(combo: Record<string, string>) {
    commit([combo]);
  }

  // Effective selected preview combos = all preview combos NOT in the
  // deselected set. New combos appearing default to selected.
  const selectedPreviewCombos = previewCombos.filter(
    (c) => !deselectedPreviewKeys.has(comboKey(c))
  );
  const selectedPreviewCount = selectedPreviewCombos.length;

  function isPreviewSelected(key: string): boolean {
    return !deselectedPreviewKeys.has(key);
  }

  function togglePreviewSelected(key: string) {
    setDeselectedPreviewKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllPreviews() {
    // Clear all deselections so every current preview is selected.
    setDeselectedPreviewKeys(new Set());
  }

  function deselectAllPreviews() {
    setDeselectedPreviewKeys(
      new Set(previewCombos.map((c) => comboKey(c)))
    );
  }

  function handleCommitSelected() {
    commit(selectedPreviewCombos);
  }

  // Prune stale entries from the deselected set whenever the preview
  // combo list changes — keeps the set scoped to combos that still
  // exist, avoiding silent state buildup across commits and axes edits.
  useEffect(() => {
    const validKeys = new Set(previewCombos.map((c) => comboKey(c)));
    setDeselectedPreviewKeys((cur) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of cur) {
        if (validKeys.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : cur;
    });
  }, [previewCombos]);

  return (
    <div>
      {/* Region A — axes manager (controlled state). Now also hosts
          the per-axis "splits into separate listings" toggle, so
          there's no longer a dedicated bottom Region C section. */}
      <PanelAxesManager
        productId={data.product.id}
        variants={data.variants.map((v) => ({
          variant_id: v.variant_id,
          attribute_combo: v.attribute_combo,
        }))}
        allAttributes={data.allAttributes}
        allAttributeValues={data.allAttributeValues}
        pendingAxes={pendingAxes}
        setPendingAxes={setPendingAxes}
        extraValuesByAxis={extraValuesByAxis}
        setExtraValuesByAxis={setExtraValuesByAxis}
        splitOverrides={splitOverrides}
        onSplitChange={handleSplitChange}
        reload={reload}
      />

      {/* Preview commit toolbar — shows when there are uncommitted combos.
          Sits ABOVE the variant list (preview cards render first below). */}
      {previewCombos.length > 0 && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 flex-wrap">
          <span className="text-xs text-amber-900 font-medium">
            {previewCombos.length}{" "}
            {previewCombos.length === 1 ? "συνδυασμός" : "συνδυασμοί"} προς δημιουργία
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {deselectedPreviewKeys.size > 0 ? (
              <button
                type="button"
                onClick={selectAllPreviews}
                className="text-[11px] text-amber-900/80 hover:text-amber-900 underline"
              >
                Επιλογή όλων
              </button>
            ) : (
              <button
                type="button"
                onClick={deselectAllPreviews}
                className="text-[11px] text-amber-900/80 hover:text-amber-900 underline"
              >
                Καθαρισμός
              </button>
            )}
            <button
              type="button"
              onClick={handleCommitSelected}
              disabled={isCommitting || selectedPreviewCount === 0}
              className="text-xs font-medium rounded bg-amber-700 text-amber-50 hover:bg-amber-800 px-2.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCommitting
                ? "Δημιουργία…"
                : `Δημιουργία ${selectedPreviewCount} επιλεγμένων`}
            </button>
          </div>
        </div>
      )}

      {commitError && (
        <p
          role="alert"
          className="mb-3 px-3 py-2 rounded-md text-xs text-red-700 bg-red-50 border border-red-200"
        >
          {commitError}
        </p>
      )}

      {/* Region B — live variant cards followed by preview cards */}
      {data.variants.length === 0 && previewCombos.length === 0 ? (
        <div className="cms-empty text-center py-6 text-sm">
          Δεν υπάρχουν παραλλαγές ακόμη. Προσθέστε άξονες παραπάνω για να
          δημιουργήσετε.
        </div>
      ) : (
        <div className="space-y-2">
          {/* Preview cards first — admin iterates on what to create
              at the top of the list, then sees the existing variants
              below for context. */}
          {previewCombos.map((c) => {
            const key = comboKey(c);
            return (
              <PreviewVariantCard
                key={`preview-${key}`}
                combo={c}
                attributeNames={data.attributeNames}
                valuesById={data.valuesById}
                allAttributes={data.allAttributes}
                allAttributeValues={data.allAttributeValues}
                basePrice={data.product.base_price}
                currency={data.product.currency}
                selected={isPreviewSelected(key)}
                onToggleSelected={() => togglePreviewSelected(key)}
                onCommit={() => handleCommitSingle(c)}
                isCommitting={isCommitting}
              />
            );
          })}
          {data.variants.map((v) => (
            <VariantCard
              key={v.variant_id}
              variant={v}
              attributeNames={data.attributeNames}
              valuesById={data.valuesById}
              currency={data.product.currency}
              images={data.images}
              imageAxes={data.product.image_axes}
              onJumpToImages={() => jumpToImagesFor(v.variant_id)}
              onOpenVariantSeo={onOpenVariantSeo}
              selected={selectedVariantIds.has(v.variant_id)}
              onToggleSelected={() => toggleVariantSelected(v.variant_id)}
              onPropagate={(kind, value) =>
                propagateVariantField(v.variant_id, kind, value)
              }
              reload={reload}
            />
          ))}
        </div>
      )}

      {/* Product specifications — read-only spec-sheet attributes,
          orthogonal to the variant axes above. */}
      <div className="mt-5 pt-4 border-t border-foreground/10">
        <ProductSpecsPanel
          productId={data.product.id}
          initial={specs}
          attributes={data.allAttributes}
          attributeValues={data.allAttributeValues}
          variantAttributeSlugs={variantAttributeSlugs}
        />
      </div>
    </div>
  );
}

/* ── Preview variant card ─────────────────────────────────────────── */

function PreviewVariantCard({
  combo,
  attributeNames,
  valuesById,
  allAttributes,
  allAttributeValues,
  basePrice,
  currency,
  selected,
  onToggleSelected,
  onCommit,
  isCommitting,
}: {
  combo: Record<string, string>;
  attributeNames: Record<string, string>;
  valuesById: ProductPanelData["valuesById"];
  allAttributes: ProductPanelData["allAttributes"];
  allAttributeValues: ProductPanelData["allAttributeValues"];
  basePrice: number;
  currency: string;
  selected: boolean;
  onToggleSelected: () => void;
  onCommit: () => void;
  isCommitting: boolean;
}) {
  // Resolve combo chips with attribute + value names. Fall back to
  // the system catalog for values that aren't in the per-variant map
  // (e.g., a value the admin just created via the axes manager).
  const comboParts: Array<{ attr: string; value: string }> = [];
  for (const [slug, valueId] of Object.entries(combo)) {
    const attrName =
      attributeNames[slug] ??
      allAttributes.find((a) => a.slug === slug)?.name ??
      slug;
    const valueName =
      valuesById[valueId]?.value ??
      allAttributeValues.find((v) => v.id === valueId)?.value ??
      "—";
    comboParts.push({ attr: attrName, value: valueName });
  }

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-sm p-3 transition-colors
        ${
          selected
            ? "border-amber-400 bg-amber-50/40"
            : "border-foreground/20 bg-foreground/[0.02]"
        }
      `}
    >
      {/* Top row: select checkbox + combo chips + Preview badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            disabled={isCommitting}
            className="mt-0.5 shrink-0"
            aria-label="Επιλογή για δημιουργία"
          />
          <div className="min-w-0 flex-1">
            {comboParts.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {comboParts.map((p, i) => (
                  <ComboChip key={i} attr={p.attr} value={p.value} />
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                Προεπιλεγμένη παραλλαγή
              </span>
            )}
          </div>
        </label>
        <span className="cms-badge bg-amber-100 border-amber-300 text-amber-900 font-semibold whitespace-nowrap text-[10px] uppercase tracking-wider">
          Preview
        </span>
      </div>

      {/* Defaults preview */}
      <div className="text-[11px] text-muted-foreground mb-3 leading-tight">
        Δημιουργείται με{" "}
        <span className="font-mono tabular-nums text-foreground/80">
          {formatCurrency(basePrice, currency)}
        </span>{" "}
        · απόθεμα{" "}
        <span className="font-mono tabular-nums text-foreground/80">0</span>{" "}
        · SKU αυτόματο
      </div>

      {/* Single-commit button */}
      <div className="flex items-center justify-end pt-2 border-t border-foreground/5">
        <button
          type="button"
          onClick={onCommit}
          disabled={isCommitting}
          className="text-xs font-medium rounded bg-foreground text-background hover:bg-foreground/85 px-2.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <span className="text-sm leading-none">+</span>
          Δημιουργία
        </button>
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  attributeNames,
  valuesById,
  currency,
  images,
  imageAxes,
  onJumpToImages,
  onOpenVariantSeo,
  selected,
  onToggleSelected,
  onPropagate,
  reload,
}: {
  variant: VariantRow;
  attributeNames: Record<string, string>;
  valuesById: ProductPanelData["valuesById"];
  currency: string;
  /** All product images — filtered per variant for the thumbnail strip. */
  images: ProductImage[];
  /** Attribute slugs that drive image selection on this product. */
  imageAxes: string[];
  /** When provided, renders the 📷→ button that jumps to the Images
   *  tab focused on this variant's image group. */
  onJumpToImages?: () => void;
  /** Open an ephemeral variant-SEO tab in the panel tab bar. Omitted in
   *  the all-variants aggregate (no per-variant SEO tabs there). */
  onOpenVariantSeo?: (variantId: string, label: string) => void;
  /** Whether this variant is part of the multi-select. */
  selected?: boolean;
  /** Toggle this variant's membership in the multi-select. When omitted,
   *  the selection checkbox is hidden (no multi-select in this context). */
  onToggleSelected?: () => void;
  /** Offer to propagate a committed field value to the other selected
   *  variants (no-op unless this variant is selected with others). */
  onPropagate?: (kind: VariantPropagateKind, value: number | boolean) => void;
  /** Re-fetch panel content + table after a delete. */
  reload: () => void;
}) {
  // "More" expander — lazy-loads suppliers + OOS/track-supply controls.
  const [expanded, setExpanded] = useState(false);
  // Cross-field refs — setInventoryLevel requires `quantityAvailable`
  // to always be passed, so a threshold-only edit needs to read the
  // latest available value, and vice versa. Refs let either field's
  // save closure see the OTHER field's current local value without
  // creating a hook-order circular reference.
  const availableRef = useRef(variant.quantity_available);
  const thresholdRef = useRef(variant.low_stock_threshold);

  // ── Auto-save fields ──────────────────────────────────────────────
  const sku = useDebouncedSave(variant.sku ?? "", async (next) => {
    const r = await updateVariant({
      id: variant.variant_id,
      sku: next.trim() || undefined,
    });
    return { success: r.success, error: !r.success ? r.error : undefined };
  });

  const price = useDebouncedSave(variant.price, async (next) => {
    const r = await updateVariant({
      id: variant.variant_id,
      price: next,
    });
    return { success: r.success, error: !r.success ? r.error : undefined };
  });

  const available = useDebouncedSave(
    variant.quantity_available,
    async (next) => {
      availableRef.current = next;
      const r = await setInventoryLevel({
        variantId: variant.variant_id,
        quantityAvailable: next,
        lowStockThreshold: thresholdRef.current,
      });
      return { success: r.success, error: !r.success ? r.error : undefined };
    }
  );

  const threshold = useDebouncedSave(
    variant.low_stock_threshold,
    async (next) => {
      thresholdRef.current = next;
      const r = await setInventoryLevel({
        variantId: variant.variant_id,
        quantityAvailable: availableRef.current,
        lowStockThreshold: next,
      });
      return { success: r.success, error: !r.success ? r.error : undefined };
    }
  );

  // Reserved direct-write — uses the `reconcileReservedTo` opt-in path
  // on setInventoryLevel. Designed for the use case "hold N units for a
  // specific customer outside the normal order lifecycle". The action
  // logs an audit event with action="inventory.set.reconciled" so the
  // override is traceable.
  const reserved = useDebouncedSave(
    variant.quantity_reserved,
    async (next) => {
      const r = await setInventoryLevel({
        variantId: variant.variant_id,
        quantityAvailable: availableRef.current,
        reconcileReservedTo: next,
      });
      return { success: r.success, error: !r.success ? r.error : undefined };
    }
  );

  // Keep refs in sync with the latest local values.
  useEffect(() => {
    availableRef.current = available.value;
  }, [available.value]);
  useEffect(() => {
    thresholdRef.current = threshold.value;
  }, [threshold.value]);

  // ── Active toggle — immediate save (no debounce) ─────────────────
  const [activeState, setActiveState] = useState<FieldState>("idle");
  const [activeError, setActiveError] = useState<string | null>(null);

  async function onToggleActive(next: boolean) {
    setActiveState("saving");
    setActiveError(null);
    const r = await updateVariant({
      id: variant.variant_id,
      isActive: next,
    });
    if (r.success) {
      setActiveState("saved");
      setTimeout(() => setActiveState("idle"), 1200);
      onPropagate?.("active", next);
    } else {
      setActiveState("error");
      setActiveError(r.error);
    }
  }

  // ── Delete — two-step armed → confirm (matches ProductDeleteButton)
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDeleteConfirm() {
    setDeleting(true);
    setDeleteError(null);
    const r = await deleteVariant({ id: variant.variant_id });
    if (r.success) {
      reload();
      // Component will unmount on reload; no need to reset state.
    } else {
      setDeleteError(r.error);
      setDeleting(false);
      setDeleteArmed(false);
    }
  }

  // ── Combo chip rendering ─────────────────────────────────────────
  const badge = STATUS_BADGE[variant.stock_status];
  const comboParts: Array<{ attr: string; value: string }> = [];
  if (variant.attribute_combo) {
    for (const [slug, valueId] of Object.entries(variant.attribute_combo)) {
      const attrName = attributeNames[slug] ?? slug;
      const valueName = valuesById[valueId]?.value ?? "—";
      comboParts.push({ attr: attrName, value: valueName });
    }
  }

  // Visible "active" — start from prop, follow toggle's optimistic flip.
  const visualActive = variant.active;

  // Filter the product's images down to those that apply to this
  // variant's combo. An image with empty/null attribute_combo applies
  // generally; an image with a partial combo applies if every entry in
  // it matches the variant. Restricted to the imagery-driving axes.
  const variantImages = filterImagesForVariant(
    images,
    variant.attribute_combo,
    imageAxes
  ).slice(0, 3);

  return (
    <div
      className={`
        border rounded-md p-2
        shadow-sm hover:shadow transition-shadow
        odd:bg-card even:bg-foreground/[0.03]
        ${
          selected
            ? "border-foreground/40 ring-1 ring-foreground/20"
            : "border-foreground/10"
        }
        ${!visualActive ? "opacity-60" : ""}
      `}
    >
      {/* Top-level layout: select checkbox + thumbnail on LEFT; right
          column collapsed to two rows — title row + a single inline
          fields-and-stats row (editable + read-only on the same line). */}
      <div className="flex items-start gap-2.5">
        {onToggleSelected && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelected}
            aria-label="Επιλογή παραλλαγής για ομαδική επεξεργασία"
            className="self-center shrink-0"
          />
        )}
        <VariantThumbnails images={variantImages} onAddImage={onJumpToImages} />

        <div className="min-w-0 flex-1 space-y-1">
          {/* Title row: chips first → price → SKU; status + jump on right.
              Price + SKU are double-click-to-edit inline displays — the
              separate inputs from the fields row below have been folded
              into these. Click anywhere else to save. */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {comboParts.length > 0 ? (
                comboParts.map((p, i) => (
                  <ComboChip key={i} attr={p.attr} value={p.value} />
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  Προεπιλεγμένη παραλλαγή
                </span>
              )}
              <DblClickSaveNumber
                field={price}
                step={0.01}
                min={0}
                width="w-24"
                format={(v) => formatCurrency(v, currency)}
                ariaLabel="Τιμή"
                displayClassName="text-base font-semibold font-mono tabular-nums text-foreground"
                onCommit={(v) => onPropagate?.("price", v)}
              />
              <DblClickSaveText
                field={sku}
                ariaLabel="SKU"
                width="w-36"
                displayClassName="text-xs text-muted-foreground"
                monospace
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Activation toggle — lives on the right edge of the variant. */}
              <span
                className="inline-flex items-center gap-1 mr-0.5"
                title="Ενεργό"
              >
                <Toggle
                  checked={visualActive}
                  onChange={onToggleActive}
                  ariaLabel="Ενεργό"
                  size="sm"
                />
                <FieldStatusIcon state={activeState} error={activeError} />
              </span>
              <span
                className={`cms-badge font-semibold whitespace-nowrap text-[10px] ${badge.className}`}
              >
                {badge.label}
              </span>
              {onJumpToImages && (
                <button
                  type="button"
                  onClick={onJumpToImages}
                  title="Δείτε τις εικόνες αυτής της παραλλαγής"
                  aria-label="Μετάβαση σε εικόνες"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-foreground/15 bg-background hover:bg-foreground/5 hover:border-foreground/30 transition-colors text-foreground/70 hover:text-foreground"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <ChevronRight className="w-3 h-3 -ml-0.5" />
                </button>
              )}
              {onOpenVariantSeo && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenVariantSeo(variant.variant_id, variant.sku ?? "παραλλαγή")
                  }
                  title="SEO παραλλαγής"
                  aria-label="SEO παραλλαγής"
                  className="inline-flex items-center px-1.5 py-0.5 rounded border border-foreground/15 bg-background hover:bg-foreground/5 hover:border-foreground/30 transition-colors text-[10px] font-semibold text-foreground/70 hover:text-foreground"
                >
                  SEO
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                title={
                  expanded
                    ? "Λιγότερα"
                    : "Περισσότερα — προμηθευτές, ορατότητα, προμήθεια"
                }
                aria-label="Περισσότερα"
                aria-expanded={expanded}
                className="inline-flex items-center px-1.5 py-0.5 rounded border border-foreground/15 bg-background hover:bg-foreground/5 hover:border-foreground/30 transition-colors text-foreground/70 hover:text-foreground"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
              </button>
              {/* Two-step delete — first click arms, second confirms.
                  Pattern matches ProductDeleteButton in the table. */}
              {deleteArmed ? (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={onDeleteConfirm}
                    disabled={deleting}
                    className="text-[11px] font-medium rounded border border-destructive bg-destructive/10 text-destructive hover:bg-destructive hover:text-background transition-colors px-1.5 py-0.5"
                    aria-label="Επιβεβαίωση διαγραφής παραλλαγής"
                    title="Επιβεβαίωση"
                  >
                    {deleting ? "..." : "Σίγουρα;"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteArmed(false)}
                    disabled={deleting}
                    aria-label="Άκυρο"
                    className="text-[11px] text-muted-foreground hover:text-foreground px-0.5"
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteArmed(true)}
                  title="Διαγραφή παραλλαγής"
                  aria-label="Διαγραφή παραλλαγής"
                  className="inline-flex items-center px-1.5 py-0.5 rounded border border-foreground/15 bg-background hover:bg-destructive/10 hover:border-destructive hover:text-destructive transition-colors text-foreground/60"
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Variant-delete error — shown inline so messages like
              "cannot delete the last variant" appear where the user
              clicked the bin icon. */}
          {deleteError && (
            <p
              role="alert"
              className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded-sm px-2 py-1"
            >
              {deleteError}
            </p>
          )}

          {/* Single inline row: stats inline as display-by-default,
              editable on double-click for fields with a write path
              (Διαθ., Όριο, Δεσμ). SKU + Τιμή live in the title row
              above. Soft + Pri are read-only system state. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <DblClickSaveNumber
              label="Διαθ."
              field={available}
              step={1}
              min={0}
              width="w-14"
              format={(v) => String(v)}
              ariaLabel="Διαθέσιμο"
              displayClassName="font-mono tabular-nums text-foreground"
              onCommit={(v) => onPropagate?.("available", v)}
            />
            <DblClickSaveNumber
              label="Όριο"
              field={threshold}
              step={1}
              min={0}
              width="w-14"
              format={(v) => String(v)}
              ariaLabel="Όριο alert"
              displayClassName="font-mono tabular-nums text-foreground"
              onCommit={(v) => onPropagate?.("threshold", v)}
            />
            <DblClickSaveNumber
              label="Δεσμ"
              hint="Άμεση παράκαμψη — η κανονική διαχείριση γίνεται μέσω παραγγελιών"
              field={reserved}
              step={1}
              min={0}
              width="w-14"
              format={(v) => String(v)}
              ariaLabel="Δεσμευμένα"
              displayClassName="font-mono tabular-nums text-foreground/80"
              onCommit={(v) => onPropagate?.("reserved", v)}
            />
            <ReadOnlyStat
              label="Σε Ενεργή Αγορά"
              value={variant.quantity_soft_held}
              hint="Διαχειρίζεται αυτόματα από συνεδρίες ολοκλήρωσης"
            />
            <ReadOnlyStat
              label="Κρατημένα Πρωτεραιότητας"
              value={variant.quantity_priority_held}
              hint="Διαχειρίζεται αυτόματα από κρατήσεις προτεραιότητας"
            />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="content-reveal">
          <VariantMorePanel variantId={variant.variant_id} />
        </div>
      )}
    </div>
  );
}

/* ── Double-click-to-edit inline field ───────────────────────────── */
/*
 * Default state: renders the value as styled display text (looks like
 * a label/title element, not an input). Double-click switches to an
 * input bound to the same debounced-save handle; blur / Enter saves
 * immediately via saveNow(); Escape exits edit mode without firing
 * saveNow (any typed change still trickles through via the regular
 * debounced save). Used for SKU + price in the variant card title row.
 */

function DblClickSaveText({
  field,
  ariaLabel,
  width,
  displayClassName,
  monospace = false,
}: {
  field: DebouncedFieldHandle<string>;
  ariaLabel: string;
  width: string;
  displayClassName: string;
  monospace?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function finishEdit() {
    field.saveNow();
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={field.value}
          onChange={(e) => field.set(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finishEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          aria-label={ariaLabel}
          className={`
            ${width} px-1.5 py-0 rounded-sm
            border border-foreground/40 bg-background
            focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/15
            ${fieldRingClass(field.state)}
            ${monospace ? "font-mono" : ""}
            ${displayClassName}
          `}
        />
        <FieldStatusIcon state={field.state} error={field.error} />
      </span>
    );
  }

  return (
    <span
      onDoubleClick={() => setEditing(true)}
      title="Διπλό κλικ για επεξεργασία"
      className={`
        inline-flex items-center gap-1
        rounded px-1 -mx-1 py-0.5
        hover:bg-foreground/5 cursor-text
        transition-colors select-none
        ${displayClassName}
      `}
    >
      {field.value || (
        <span className="text-muted-foreground/60">—</span>
      )}
      <FieldStatusIcon state={field.state} error={field.error} />
    </span>
  );
}

function DblClickSaveNumber({
  field,
  step = 0.01,
  min = 0,
  width,
  format,
  ariaLabel,
  displayClassName,
  onCommit,
  label,
  hint,
}: {
  field: DebouncedFieldHandle<number>;
  step?: number;
  min?: number;
  width: string;
  /** Formatter for display mode (e.g., formatCurrency). Edit mode shows
   *  the raw number string so the input is keyboard-friendly. */
  format: (v: number) => string;
  ariaLabel: string;
  displayClassName: string;
  /** Fires on explicit commit (blur/Enter) with the committed value —
   *  used to offer bulk propagation across selected variants. */
  onCommit?: (value: number) => void;
  /** Optional inline caption (e.g. "Διαθ."). When set it renders INSIDE the
   *  double-click target so double-clicking the label — not just the tiny
   *  value — enters edit mode. */
  label?: string;
  /** Tooltip hint appended before the "double-click to edit" note. */
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState<string>(String(field.value));
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync edit-text snapshot when we open the input (so it shows the
  // current raw value, not a stale one from previous edits).
  function enterEdit() {
    setEditText(String(field.value));
    setEditing(true);
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function finishEdit() {
    const parsed = Number(editText);
    if (Number.isFinite(parsed) && parsed !== field.value) {
      field.set(parsed);
    }
    field.saveNow();
    setEditing(false);
    if (Number.isFinite(parsed)) onCommit?.(parsed);
  }

  if (editing) {
    return (
      <span className="inline-flex items-baseline gap-1">
        {label && <span className="text-muted-foreground">{label}</span>}
        <input
          ref={inputRef}
          type="number"
          step={step}
          min={min}
          inputMode="decimal"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finishEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          aria-label={ariaLabel}
          className={`
            ${width} px-1.5 py-0 rounded-sm tabular-nums
            border border-foreground/40 bg-background
            focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/15
            ${fieldRingClass(field.state)}
            ${displayClassName}
          `}
        />
        <FieldStatusIcon state={field.state} error={field.error} />
      </span>
    );
  }

  return (
    <span
      onDoubleClick={enterEdit}
      title={[hint, "Διπλό κλικ για επεξεργασία"].filter(Boolean).join(" · ")}
      className="
        inline-flex items-baseline gap-1
        rounded px-1.5 -mx-1 py-0.5
        hover:bg-foreground/[0.06] hover:ring-1 hover:ring-foreground/15
        cursor-text transition-colors select-none
      "
    >
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className={displayClassName}>{format(field.value)}</span>
      <FieldStatusIcon state={field.state} error={field.error} />
    </span>
  );
}

/* ── Loading state shown while data is in flight ──────────────────── */
/*
 * Rendered between the optimistic panel-open and the server's data
 * arrival. Mirrors PanelContent's header shape so the panel doesn't
 * visually jump when content swaps in.
 */

function PanelLoadingState({ onClose }: { onClose: () => void }) {
  return (
    <>
      <header className="px-5 pt-5 pb-3 border-b border-foreground/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="h-5 w-48 rounded bg-foreground/10 animate-pulse" />
            <div className="h-3 w-32 rounded bg-foreground/10 animate-pulse mt-2" />
            <div className="h-4 w-20 rounded bg-foreground/10 animate-pulse mt-2" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="p-1.5 rounded-sm hover:bg-foreground/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin" />
          Φόρτωση…
        </div>
      </div>
    </>
  );
}

/* ── Error state (fetch failed / product not found) ───────────────── */

function PanelErrorState({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className="px-5 pt-5 pb-3 border-b border-foreground/10">
        <div className="flex items-start justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="p-1.5 rounded-sm hover:bg-foreground/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary btn-sm"
        >
          Δοκιμή ξανά
        </button>
      </div>
    </>
  );
}

/* ── Read-only stat ───────────────────────────────────────────────── */
/*
 * Static "label value" pairing for the variant card's stats row (system
 * state with no write path). Editable stats render via DblClickSaveNumber
 * with its own inline `label` so the whole label→value area is the
 * double-click target.
 */

function ReadOnlyStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px]"
      title={hint}
    >
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-mono tabular-nums text-foreground/60">
        {value}
      </span>
    </span>
  );
}

/* ── Combo chip — attribute:value pill used in variant card headers ─ */

function ComboChip({ attr, value }: { attr: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-foreground/25 bg-background px-2 py-0.5 text-sm leading-tight whitespace-nowrap shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <span className="text-muted-foreground">{attr}:</span>
      <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
}

/* ── Variant thumbnails (up to 3) ──────────────────────────────────── */

/**
 * Single enlarged thumbnail anchored on the left of the variant card,
 * sized to match the right column's stacked content (~80×80). When the
 * variant has more applicable images than the one rendered, a "+N"
 * badge overlays the bottom-right corner so the count stays visible
 * without taking extra horizontal space. Empty state: dashed
 * placeholder of identical dimensions so the right column doesn't shift.
 */
function VariantThumbnails({
  images,
  onAddImage,
}: {
  images: ProductImage[];
  /** When set, the empty placeholder becomes a "+" that jumps to the
   *  Images tab focused on this variant. */
  onAddImage?: () => void;
}) {
  if (images.length === 0) {
    if (onAddImage) {
      return (
        <button
          type="button"
          onClick={onAddImage}
          title="Προσθήκη εικόνων παραλλαγής"
          aria-label="Προσθήκη εικόνων παραλλαγής"
          className="group/vthumb shrink-0 relative w-16 h-16 rounded-md border border-dashed border-foreground/15 bg-foreground/[0.02] hover:border-foreground/40 hover:bg-foreground/[0.04] transition-colors flex items-center justify-center"
        >
          <ImageIcon
            className="w-5 h-5 text-foreground/25 group-hover/vthumb:opacity-0 transition-opacity"
            aria-hidden
          />
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/vthumb:opacity-100 transition-opacity text-foreground/70 text-xl leading-none">
            +
          </span>
        </button>
      );
    }
    return (
      <div className="shrink-0 w-16 h-16 rounded-md border border-dashed border-foreground/15 bg-foreground/[0.02] flex items-center justify-center">
        <ImageIcon className="w-5 h-5 text-foreground/25" aria-hidden />
      </div>
    );
  }
  const primary = images[0];
  const extraCount = images.length - 1;
  return (
    <div className="shrink-0 relative w-16 h-16 rounded-md border border-foreground/15 bg-background overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={primary.url ?? ""}
        alt={primary.alt_text ?? ""}
        className="w-full h-full object-cover"
      />
      {extraCount > 0 && (
        <span
          className="absolute bottom-0.5 right-0.5 rounded-sm bg-foreground/80 text-background text-[9px] font-mono font-semibold px-1 py-0.5 leading-none"
          title={`${images.length} εικόνες`}
        >
          +{extraCount}
        </span>
      )}
    </div>
  );
}

/**
 * Filter product images down to those that apply to a given variant
 * combo, restricted to the axes that drive imagery. Sorted cover-first,
 * then by display_order. Mirrors the storefront's variant→image
 * selection logic.
 */
function filterImagesForVariant(
  allImages: ProductImage[],
  variantCombo: Record<string, string> | null,
  imageAxes: string[]
): ProductImage[] {
  if (!variantCombo) {
    // No combo → only general images.
    return allImages.filter((img) => isGeneralImage(img));
  }
  const axisSet = new Set(imageAxes);
  return allImages
    .filter((img) => {
      if (isGeneralImage(img)) return true;
      // Every key in image's combo must match the variant AND be in the
      // image-driving axes.
      for (const [slug, valueId] of Object.entries(img.attribute_combo ?? {})) {
        if (!axisSet.has(slug)) return false;
        if (variantCombo[slug] !== valueId) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;
      return a.display_order - b.display_order;
    });
}

function isGeneralImage(img: ProductImage): boolean {
  return (
    img.attribute_combo === null ||
    Object.keys(img.attribute_combo).length === 0
  );
}

/* ── Field building blocks ────────────────────────────────────────── */

function fieldRingClass(state: FieldState): string {
  switch (state) {
    case "dirty":
      return "ring-1 ring-amber-300/60 border-amber-300/60";
    case "saving":
      return "ring-1 ring-stone-300 border-stone-300";
    case "saved":
      return "ring-1 ring-emerald-300/60 border-emerald-300/60";
    case "error":
      return "ring-1 ring-red-400 border-red-400";
    default:
      return "";
  }
}

function FieldStatusIcon({
  state,
  error,
}: {
  state: FieldState;
  error: string | null;
}) {
  if (state === "idle") return null;
  if (state === "dirty")
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
        title="Μη αποθηκευμένο"
        aria-hidden
      />
    );
  if (state === "saving")
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full border-2 border-stone-300 border-t-foreground/70 animate-spin"
        title="Αποθήκευση…"
        aria-hidden
      />
    );
  if (state === "saved")
    return (
      <span
        className="inline-block text-emerald-600 text-xs"
        title="Αποθηκεύτηκε"
        aria-hidden
      >
        ✓
      </span>
    );
  return (
    <span
      className="inline-block text-red-600 text-xs"
      title={error ?? "Σφάλμα αποθήκευσης"}
      aria-hidden
    >
      ⚠
    </span>
  );
}

function AutoSaveTextInput({
  label,
  value,
  onChange,
  onBlur,
  state,
  error,
  monospace = false,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  state: FieldState;
  error: string | null;
  monospace?: boolean;
}) {
  return (
    <label className="block">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1.5">
          {label}
          <FieldStatusIcon state={state} error={error} />
        </span>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        title={error ?? undefined}
        className={`
          w-full px-2 py-1.5 text-sm rounded-sm
          border border-foreground/15 bg-background
          focus:outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10
          transition-all
          ${monospace ? "font-mono" : ""}
          ${fieldRingClass(state)}
        `}
      />
    </label>
  );
}

function AutoSaveNumberInput({
  label,
  value,
  onChange,
  onBlur,
  state,
  error,
  step = 1,
  min,
  suffix,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  onBlur?: () => void;
  state: FieldState;
  error: string | null;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  // Local string state so partial entries like "12." don't get parsed to
  // NaN and round-tripped back to the user as "12". The value the parent
  // sees is the parsed number; we only sync local from upstream when not
  // mid-edit.
  const [text, setText] = useState<string>(formatNumber(value, step));
  const lastUpstreamRef = useRef(value);

  useEffect(() => {
    // Only re-sync from upstream when nothing is in flight (parent has
    // re-rendered with a settled value and we're not actively typing).
    if (state === "idle" || state === "saved") {
      if (lastUpstreamRef.current !== value) {
        setText(formatNumber(value, step));
        lastUpstreamRef.current = value;
      }
    }
  }, [value, state, step]);

  return (
    <label className="block">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1.5">
          {label}
          <FieldStatusIcon state={state} error={error} />
        </span>
      )}
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => {
            // Normalize display + commit save
            const parsed = Number(text);
            if (Number.isFinite(parsed)) {
              setText(formatNumber(parsed, step));
            }
            onBlur?.();
          }}
          title={error ?? undefined}
          className={`
            w-full px-2 py-1.5 text-sm rounded-sm font-mono tabular-nums
            border border-foreground/15 bg-background
            focus:outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10
            transition-all
            ${suffix ? "pr-9" : ""}
            ${fieldRingClass(state)}
          `}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function ReadonlyStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 block">
        {label}
      </span>
      <div className="w-full px-2 py-1.5 text-sm rounded-sm border border-foreground/5 bg-foreground/[0.03] font-mono tabular-nums text-foreground/70">
        {value}
      </div>
    </div>
  );
}

/* ── Compact inline auto-save fields ──────────────────────────────── */
/*
 * Used inside variant cards where vertical real-estate is tight. The
 * label sits inline before the input; the input is sized to its
 * expected content via the `width` prop (Tailwind width class). Status
 * indicator stays attached to the right.
 */

function CompactSaveText({
  label,
  value,
  onChange,
  onBlur,
  state,
  error,
  width,
  monospace = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  state: FieldState;
  error: string | null;
  width: string;
  monospace?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        title={error ?? undefined}
        className={`
          ${width} px-1.5 py-0.5 text-xs rounded-sm
          border border-foreground/15 bg-background
          focus:outline-none focus:border-foreground/40 focus:ring-1 focus:ring-foreground/15
          transition-all
          ${monospace ? "font-mono" : ""}
          ${fieldRingClass(state)}
        `}
      />
      <FieldStatusIcon state={state} error={error} />
    </span>
  );
}

function CompactSaveNumber({
  label,
  value,
  onChange,
  onBlur,
  state,
  error,
  step = 1,
  min,
  suffix,
  width,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onBlur?: () => void;
  state: FieldState;
  error: string | null;
  step?: number;
  min?: number;
  suffix?: string;
  width: string;
}) {
  const [text, setText] = useState<string>(formatNumber(value, step));
  const lastUpstreamRef = useRef(value);

  useEffect(() => {
    if (state === "idle" || state === "saved") {
      if (lastUpstreamRef.current !== value) {
        setText(formatNumber(value, step));
        lastUpstreamRef.current = value;
      }
    }
  }, [value, state, step]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = Number(text);
          if (Number.isFinite(parsed)) {
            setText(formatNumber(parsed, step));
          }
          onBlur?.();
        }}
        title={error ?? undefined}
        className={`
          ${width} px-1.5 py-0.5 text-xs rounded-sm font-mono tabular-nums
          border border-foreground/15 bg-background
          focus:outline-none focus:border-foreground/40 focus:ring-1 focus:ring-foreground/15
          transition-all
          ${fieldRingClass(state)}
        `}
      />
      {suffix && (
        <span className="text-[10px] text-muted-foreground">{suffix}</span>
      )}
      <FieldStatusIcon state={state} error={error} />
    </span>
  );
}

/**
 * Format a number for the input — fractional digits derive from the
 * step (0.01 → 2 digits, 1 → 0 digits). Keeps integers from displaying
 * as "12.00" while keeping currency prices as "25.00".
 */
function formatNumber(n: number, step: number): string {
  if (step >= 1) return Math.round(n).toString();
  const fraction = step.toString().split(".")[1]?.length ?? 0;
  return n.toFixed(fraction);
}

/* ── All-variants panel ────────────────────────────────────────────── */

const ALL_VARIANTS_PAGE_SIZE = 8;

/**
 * "All variants" view — opened from the edge indicator while the panel is
 * closed. Shows every variant of every in-scope product (explicit selection,
 * else the table's active filters), grouped per product, paginated.
 *
 * Each product group is the same editable VariantCard used in the per-product
 * Παραλλαγές tab (inline price / stock / SKU / active / delete). Deeper config
 * (axes, images, SEO, specs) is one click away via "Άνοιγμα" → the full
 * product panel.
 */
function AllVariantsPanel({
  scope,
  onClose,
  onOpenProduct,
}: {
  scope: AllVariantsScope;
  onClose: () => void;
  onOpenProduct: (productId: string) => void;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AllVariantsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reloadNonce, setReloadNonce] = useState(0);
  const reqToken = useRef(0);

  const explicit = !scope.matchAll && scope.selectedIds.length > 0;

  // Reset to page 1 whenever the scope identity changes (new open).
  useEffect(() => {
    setPage(1);
  }, [scope]);

  useEffect(() => {
    const myToken = ++reqToken.current;
    setLoading(true);
    setError(null);
    getAllVariantsData({
      explicitIds: explicit ? scope.selectedIds : null,
      matchAll: scope.matchAll,
      filterParams: scope.filterParams,
      page,
      pageSize: ALL_VARIANTS_PAGE_SIZE,
    })
      .then((res) => {
        if (myToken !== reqToken.current) return;
        setResult(res);
        setLoading(false);
      })
      .catch(() => {
        if (myToken !== reqToken.current) return;
        setError("Σφάλμα φόρτωσης παραλλαγών.");
        setLoading(false);
      });
  }, [scope, explicit, page, reloadNonce]);

  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1);
    router.refresh();
  }, [router]);

  function toggleCollapsed(id: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ALL_VARIANTS_PAGE_SIZE));

  return (
    <>
      <header className="px-5 pt-5 pb-3 border-b border-foreground/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-foreground truncate">
              Όλες οι παραλλαγές
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {explicit
                ? `${total.toLocaleString("el-GR")} επιλεγμένα προϊόντα`
                : `${total.toLocaleString("el-GR")} προϊόντα`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="p-1.5 rounded-sm hover:bg-foreground/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <span className="inline-block w-4 h-4 mr-2 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin" />
            Φόρτωση…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </p>
        ) : !result || result.products.length === 0 ? (
          <div className="cms-empty text-center py-8 text-sm">
            Δεν βρέθηκαν προϊόντα.
          </div>
        ) : (
          <div className="space-y-3 content-reveal">
            {result.products.map((p) => {
              const isCollapsed = collapsed.has(p.product.id);
              return (
                <div
                  key={p.product.id}
                  className="border border-foreground/10 rounded-md overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2 bg-foreground/[0.03] border-b border-foreground/10">
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(p.product.id)}
                      aria-expanded={!isCollapsed}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${
                          isCollapsed ? "" : "rotate-90"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-sm text-foreground truncate">
                          {p.product.name}
                        </span>
                        <span className="block font-mono text-[11px] text-muted-foreground truncate">
                          {p.product.base_sku ?? "—"} ·{" "}
                          {formatCurrency(
                            p.product.base_price,
                            p.product.currency
                          )}
                        </span>
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {p.variants.length}{" "}
                        {p.variants.length === 1 ? "παραλλαγή" : "παραλλαγές"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenProduct(p.product.id)}
                      title="Άνοιγμα προϊόντος (άξονες, εικόνες, SEO)"
                      className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-foreground/15 bg-background hover:bg-foreground/5 hover:border-foreground/30 transition-colors text-foreground/70 hover:text-foreground"
                    >
                      Άνοιγμα
                      <ChevronRight className="w-3 h-3 -ml-0.5" />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="p-2 space-y-2">
                      {p.variants.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic px-1 py-2">
                          Καμία παραλλαγή.
                        </p>
                      ) : (
                        p.variants.map((v) => (
                          <VariantCard
                            key={v.variant_id}
                            variant={v}
                            attributeNames={p.attributeNames}
                            valuesById={p.valuesById}
                            currency={p.product.currency}
                            images={p.images}
                            imageAxes={p.product.image_axes}
                            reload={reload}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {!loading && !error && total > ALL_VARIANTS_PAGE_SIZE && (
        <div className="px-5 py-3 border-t border-foreground/10 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPage((pg) => Math.max(1, pg - 1))}
            disabled={page <= 1}
            className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Προηγούμενα
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            Σελίδα {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
            disabled={page >= totalPages}
            className="btn btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Επόμενα →
          </button>
        </div>
      )}
    </>
  );
}

