"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ChevronUp, ChevronDown } from "lucide-react";
import VariantPicker, {
  type PickerValueLookup,
} from "@/components/features/products/VariantPicker";
import ImageCarousel from "@/components/features/products/ImageCarousel";
import AddToCartButton from "@/components/features/cart/AddToCartButton";
import NotifyMeButton from "@/components/features/contention/NotifyMeButton";
import WishlistHeartButton from "@/components/features/wishlist/WishlistHeartButton";
import RequirePermission from "@/components/features/rbac/RequirePermission";
import OfferBadge from "@/components/features/products/OfferBadge";
import type { VariantOfferState } from "@/types/offers";
import type { OfferRuleSummary } from "@/lib/site-search/searchVariants";
import { useVariantInventoryRealtime } from "@/hooks/useVariantInventoryRealtime";
import { getContestableAvailableAction } from "@/actions/inventory/getContestableAvailableAction";
import {
  publishQuantity,
  subscribeStore,
  getStoreSnapshot,
} from "@/components/features/custom-fields/_formStore";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import type { ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import { selectImagesForVariant } from "@/lib/products/selectImagesForVariant";
import { strings } from "@/config/strings";

interface Props {
  productId: string;
  productName: string;
  /** Optional brand, shown as a mono eyebrow above the title. */
  brand?: string | null;
  /** All product images. The selection algorithm subset-matches each image's attribute_combo against the selected variant restricted to imageAxes. */
  images: ProductImage[];
  /**
   * Attribute slugs that drive image selection on this product
   * (`products.image_axes`). When the customer's picker changes one
   * of these, imagery swaps. Empty array = no axes drive imagery.
   */
  imageAxes: string[];
  variants: ProductVariant[];
  /**
   * Pre-computed price labels for each variant (already converted into the
   * active display currency and formatted server-side).
   * Key: variant id. Value: formatted price string.
   */
  variantPriceLabels: Record<string, string>;
  /**
   * Original (pre-discount) price labels per variant, populated only
   * when an auto-apply offer reduces the price. Used for crossed-out
   * display alongside the effective price.
   */
  variantOriginalPriceLabels?: Record<string, string>;
  /**
   * Per-variant offer state for badge rendering. Only contains entries
   * for variants that have an auto-apply discount.
   */
  offerStatesByVariant?: Record<string, VariantOfferState>;
  /** Rule summaries for the offers referenced in offerStatesByVariant. */
  offerRulesById?: Record<string, OfferRuleSummary>;
  /** Fallback price label for when no variant is selectable. */
  basePriceLabel: string;
  /** Variant pre-selected by the URL (split-listing). Falls back to first if null. */
  initialVariantId?: string | null;
  /**
   * Effective availability per variant — snapshot from server render. When
   * a variant's availability is 0, the CTA flips from "Add to Cart" to
   * "Notify me when available." Phase 4 adds Realtime updates so this stays
   * fresh without a page refresh.
   */
  effectiveAvailableByVariant: Record<string, number>;
  /** Attribute display names keyed by slug, for picker row labels. */
  attributeNames: Record<string, string>;
  /** attribute_values keyed by id, for picker chip labels. */
  valuesById: Record<string, PickerValueLookup>;
  /** Active currency code — used to format the live "+X" modifier suffix
   *  appended to the price line when custom-field options carry a price
   *  delta. Server passes the customer's display currency. */
  activeCurrency: string;
  /** Custom-fields form rendered right under the add-to-cart CTA so it
   *  reads as a "quick access" picker instead of a separate page
   *  section. Passed in as a slot because the form is a client
   *  component itself and we want the parent to control resolution. */
  customFieldsSlot?: ReactNode;
}

/**
 * Client wrapper around the variant picker, image, price, and CTA buttons.
 * Owning the selected variant in client state lets the price and image react
 * to the user's choice without a round-trip to the server.
 */
export default function ProductDetailInteractive({
  productId,
  productName,
  brand,
  images,
  imageAxes,
  variants,
  variantPriceLabels,
  variantOriginalPriceLabels,
  offerStatesByVariant,
  offerRulesById,
  basePriceLabel,
  initialVariantId,
  effectiveAvailableByVariant,
  attributeNames,
  valuesById,
  activeCurrency,
  customFieldsSlot,
}: Props) {
  // Default: variant pre-selected by URL (split-listing), else the first variant.
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialVariantId ?? variants[0]?.id ?? null
  );

  // Per-variant quantity selection. Each variant remembers its own count so
  // switching A → B → A restores A's prior pick. Display is always clamped
  // to current effective availability (live-updated via Realtime below).
  const [quantityByVariant, setQuantityByVariant] = useState<
    Record<string, number>
  >({});

  // Phase 4D: live mirror of effectiveAvailableByVariant. Seeded from the
  // server render and refreshed in response to Supabase Realtime change
  // events on inventory_items. Drives the Add-to-Cart / Notify-me CTA flip.
  const [liveAvailability, setLiveAvailability] = useState<
    Record<string, number>
  >(effectiveAvailableByVariant);
  useEffect(() => {
    setLiveAvailability(effectiveAvailableByVariant);
  }, [effectiveAvailableByVariant]);

  const variantIds = useMemo(() => variants.map((v) => v.id), [variants]);
  const [, startRefetch] = useTransition();
  // Debounce realtime-driven refetches so a burst of inventory changes
  // (e.g., a release_soft + advance_soft_wait_queue sequence) coalesces
  // into a single round trip.
  const refetchTimeoutRef = useRef<number | null>(null);

  useVariantInventoryRealtime({
    variantIds,
    onChange: () => {
      if (refetchTimeoutRef.current !== null) {
        window.clearTimeout(refetchTimeoutRef.current);
      }
      refetchTimeoutRef.current = window.setTimeout(() => {
        refetchTimeoutRef.current = null;
        startRefetch(async () => {
          const next = await getContestableAvailableAction(variantIds);
          setLiveAvailability(next);
        });
      }, 250);
    },
  });
  useEffect(() => {
    return () => {
      if (refetchTimeoutRef.current !== null) {
        window.clearTimeout(refetchTimeoutRef.current);
      }
    };
  }, []);

  // Compute the active image set via the combo-aware selection
  // algorithm. Subset-matches each image's attribute_combo against
  // the selected variant restricted to imageAxes. Returns variant-
  // specific first, then general; is_cover first within each group,
  // then display_order.
  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) ?? null,
    [selectedVariantId, variants]
  );

  // Dynamic title — append the selected variant's attribute_combo
  // values (looked up via valuesById) to the product name. Mirrors
  // the catalog tile pattern: "Shoe — Καστόρ" / "Shoe — Καστόρ / 32".
  // Falls back to the bare product name when no variant is selected
  // or the variant has no attribute_combo (single-SKU products).
  const dynamicTitle = useMemo(() => {
    if (!selectedVariant?.attribute_combo) return productName;
    const parts: string[] = [];
    for (const valueId of Object.values(selectedVariant.attribute_combo)) {
      const v = valuesById[valueId];
      if (v) parts.push(v.value);
    }
    if (parts.length === 0) return productName;
    return `${productName} — ${parts.join(" / ")}`;
  }, [productName, selectedVariant, valuesById]);

  const activeImages = useMemo(
    () => selectImagesForVariant({ image_axes: imageAxes }, selectedVariant, images),
    [imageAxes, selectedVariant, images]
  );

  const priceLabel =
    (selectedVariantId && variantPriceLabels[selectedVariantId]) ?? basePriceLabel;
  // Offer state for the SELECTED variant. When the variant
  // picker swaps variants, these flip with it — driving the crossed-out
  // price and the badge change live without a server round-trip.
  const originalPriceLabel =
    selectedVariantId && variantOriginalPriceLabels
      ? variantOriginalPriceLabels[selectedVariantId]
      : undefined;
  const offerRuleForSelected = (() => {
    if (!selectedVariantId || !offerStatesByVariant || !offerRulesById) return null;
    const state = offerStatesByVariant[selectedVariantId];
    if (!state || state.rule_id === null) return null;
    return offerRulesById[state.rule_id] ?? null;
  })();

  // Hide the variant picker if there's only one variant and it has no attributes
  // (i.e., the auto-created "default" variant for a simple product).
  const showPicker =
    variants.length > 1 ||
    (variants.length === 1 && variants[0].attribute_combo !== null);

  const effectiveAvailable = selectedVariantId
    ? liveAvailability[selectedVariantId] ?? 0
    : 0;
  const isAvailable = effectiveAvailable > 0;

  // Clamp the displayed quantity to the live cap. Saved preference stays
  // unchanged so if stock comes back up the user's earlier pick is preserved.
  const selectedQuantity =
    selectedVariantId && isAvailable
      ? Math.min(
          Math.max(1, quantityByVariant[selectedVariantId] ?? 1),
          effectiveAvailable
        )
      : 1;

  // Phase 8i: publish the current effective quantity to the custom-
  // fields form store so per_unit fields render the right number of
  // instances + the validator demands a value per unit. The store
  // ignores duplicate publishes so this is cheap to call every render.
  useEffect(() => {
    publishQuantity(selectedQuantity);
  }, [selectedQuantity]);

  // Subscribe to the custom-fields form's running modifier total so
  // the price line above the CTA can render a live "+ X" suffix.
  // Defaults to 0 when no form is mounted (e.g. product has no
  // applicable custom fields).
  const modifierTotal = useSyncExternalStore(
    subscribeStore,
    () => getStoreSnapshot().modifier_total,
    () => 0
  );
  const modifierSuffix =
    modifierTotal > 0
      ? ` + ${formatCurrency(modifierTotal, activeCurrency)}`
      : "";

  return (
    <>
      {/* Carousel handles the LCP-priority hero (first image), arrow
          navigation, indicator bullets, and click-to-open lightbox.
          The activeImages array is recomputed by the combo-aware
          selection algorithm whenever the picker swaps variants on an
          image-driving axis. */}
      <ImageCarousel
        images={activeImages}
        alt={dynamicTitle}
        priority
      />

      <div>
        {/* Admin-only edit shortcut — subtle, top-right; hidden for customers. */}
        <RequirePermission permission="manage:products">
          <div className="flex justify-end mb-1">
            <Link
              href={`/admin/products?focus=${productId}`}
              className="text-[11px] font-mono uppercase tracking-wider text-stone-taupe hover:text-terracotta transition-colors"
            >
              Επεξεργασία →
            </Link>
          </div>
        </RequirePermission>
        {brand && (
          <span className="block text-[10px] font-mono uppercase tracking-widest text-stone-taupe font-bold mb-2.5">
            {brand}
          </span>
        )}
        <h1 className="!font-sans text-2xl sm:text-3xl font-bold tracking-tight text-ink leading-snug mb-3">
          {dynamicTitle}
        </h1>

        {showPicker && (
          <div className="mt-11">
            <VariantPicker
              variants={variants}
              initialVariantId={selectedVariantId}
              variantPriceLabels={variantPriceLabels}
              attributeNames={attributeNames}
              valuesById={valuesById}
              onChange={setSelectedVariantId}
            />
          </div>
        )}

        {selectedVariantId && !isAvailable && (
          <p className="mt-3 text-sm text-muted-foreground">
            Αυτό το προϊόν δεν είναι διαθέσιμο αυτή τη στιγμή.
          </p>
        )}
        {selectedVariantId && isAvailable && effectiveAvailable <= 3 && (
          <p className="mt-3 text-sm text-amber-700">
            Σχεδόν εξαντλημένο — μόνο {effectiveAvailable}{" "}
            {effectiveAvailable === 1 ? "τεμάχιο" : "τεμάχια"} σε απόθεμα.
          </p>
        )}

        {/* Product configuration (custom fields) — above the CTA so required
            options (e.g. child's name) are filled before adding to cart. */}
        {customFieldsSlot && <div className="mt-6">{customFieldsSlot}</div>}

        <div className="mt-6 pt-6 border-t border-stone-taupe/20">
          {/* Price on the left; the circular action icons (wishlist + notify)
              sit side by side to its right, each revealing its label on hover. */}
          {/* Price on the left; the circular action icons (wishlist + notify)
              sit side by side to its right, each revealing its label on hover. */}
          <div className="flex items-center gap-5 mb-6 flex-wrap">
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="font-sans tabular-nums [word-spacing:-0.18em] text-3xl font-bold text-terracotta">
                {priceLabel}
                {modifierSuffix && (
                  <span className="text-lg text-terracotta/80 font-semibold">
                    {modifierSuffix}
                  </span>
                )}
              </p>
              {originalPriceLabel && (
                <p className="text-sm text-muted-foreground line-through">
                  {originalPriceLabel}
                </p>
              )}
              {offerRuleForSelected && <OfferBadge rule={offerRuleForSelected} />}
            </div>
            <div className="flex items-start gap-4">
              {!isAvailable && (
                <NotifyMeButton
                  productId={productId}
                  variantId={selectedVariantId ?? undefined}
                  productName={productName}
                />
              )}
              <WishlistHeartButton
                productId={productId}
                variantId={selectedVariantId ?? undefined}
                variant="icon"
                label="Λίστα Επιθυμιών"
              />
            </div>
          </div>

          {isAvailable && (
            // Quantity stepper merged flush with the Add-to-Cart button into one
            // control. The up/down chevrons are painted in the button's
            // terracotta colour so they're clearly visible and easy to tap.
            <div className="flex items-stretch">
              <div className="flex items-center gap-2 h-11 pl-3.5 pr-2 rounded-l-sm border border-r-0 border-stone-taupe/40 bg-card">
                <span className="text-base font-semibold text-ink tabular-nums w-5 text-center">
                  {selectedQuantity}
                </span>
                <div className="flex flex-col justify-center -space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedVariantId) return;
                      const next = Math.min(selectedQuantity + 1, effectiveAvailable);
                      setQuantityByVariant((prev) => ({ ...prev, [selectedVariantId]: next }));
                    }}
                    disabled={selectedQuantity >= effectiveAvailable}
                    aria-label="Αύξηση ποσότητας"
                    className="text-terracotta hover:text-terracotta/70 disabled:opacity-30 transition-colors leading-none"
                  >
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedVariantId) return;
                      const next = Math.max(selectedQuantity - 1, 1);
                      setQuantityByVariant((prev) => ({ ...prev, [selectedVariantId]: next }));
                    }}
                    disabled={selectedQuantity <= 1}
                    aria-label="Μείωση ποσότητας"
                    className="text-terracotta hover:text-terracotta/70 disabled:opacity-30 transition-colors leading-none"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1">
                <AddToCartButton
                  productId={productId}
                  variantId={selectedVariantId ?? undefined}
                  quantity={selectedQuantity}
                  fullWidth
                  buttonClassName="!rounded-l-none"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
