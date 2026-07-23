"use client";

import { useState, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createProduct } from "@/actions/products/createProduct";
import { updateProduct } from "@/actions/products/updateProduct";
import { slugify } from "@/lib/slugify";
import Toggle from "@/components/admin/common/Toggle";
import AxesEditor from "@/components/admin/products/AxesEditor";
import ProductSpecsPanel from "@/components/admin/products/ProductSpecsPanel";
import SplitOverridesPanel from "@/components/admin/products/SplitOverridesPanel";
import ProductImagesComboTab from "@/components/admin/products/images/ProductImagesComboTab";
import type { StagedImage } from "@/types/staged-image";
import {
  Info,
  Tag,
  Truck,
  Eye,
  Package,
  Layers,
} from "@/components/admin/common/icons";
import type { Product } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type { ProductSpecificationView } from "@/types/product-specifications";
import type { VatRate } from "@/types/vat-rates";
import type { VolumetricPrefix } from "@/types/volumetric";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

/**
 * Currency dropdown options. EUR-first because that's the storefront's
 * primary market; USD/GBP supported for occasional international suppliers
 * and exports. Add more values here when needed — the action layer
 * already validates ISO-4217 length only.
 */
const CURRENCY_OPTIONS = ["EUR", "USD", "GBP"] as const;

interface CommonProps {
  vatRates: VatRate[];
  /**
   * Active volumetric prefixes for the size-class dropdown in the
   * Logistics section. Pass an empty array to hide the dropdown.
   */
  volumetricPrefixes: VolumetricPrefix[];
  /** Global default for show_when_oos — used to resolve null into a concrete boolean. */
  globalShowWhenOosDefault: boolean;
  /**
   * Selectively render parts of the form. The create-page wraps this
   * component in a tabs structure (Επισκόπηση / Παραλλαγές); each tab
   * mounts ProductForm with a different `visibleSections` value so
   * the same form instance owns all state but only paints the active
   * tab's sections.
   *
   *   - 'all'      (default; edit mode uses this) → render every section
   *   - 'overview' → only the overview-tab sections: Βασικά, Logistics,
   *                  Ορατότητα, Τιμολόγηση, Initial Supplier, Categories
   *   - 'variants' → only the Variants section, full-width
   *
   * Hiding sections does NOT discard their state — react-tree-wise the
   * sections are conditionally rendered but the state hooks above stay
   * mounted because ProductForm itself is mounted.
   */
  visibleSections?: "all" | "overview" | "variants" | "images";
}

interface CreateModeProps extends CommonProps {
  mode: "create";
  /**
   * Callback fired when the admin clicks the "Next Step — Add Variants"
   * CTA on the overview tab (only relevant when visibleSections='overview').
   * The parent uses this to advance the active tab from overview → variants.
   * When omitted, the form falls back to its single-screen submit pattern
   * (legacy / dev usage).
   */
  onNextStep?: () => void;
  /** All active categories — rendered inline as a checkbox grid and
   *  bundled into the createProduct call. Edit mode uses a separate
   *  slot-injected editor with its own save lifecycle. */
  categories: Category[];
  /** All active suppliers — surfaced in the "Initial supplier"
   *  section so the admin can link a supplier + unit cost at
   *  creation time. The default supplier propagates to every
   *  variant created with the product (placeholder now, axis
   *  expansion later — see addMatrixCombos). Edit mode uses the
   *  per-variant Suppliers section instead. */
  suppliers: Supplier[];
  /** Attributes catalog (Color, Size, Material, …) — drives the
   *  "Add axis" picker in the Variants section. New attributes can
   *  be created inline; the local mirror state appends them so
   *  subsequent picks see the updated catalog. */
  attributes: Attribute[];
  /** Attribute values catalog (Red, Blue, S, M, L, …) — drives the
   *  per-axis value picker. New values can also be created inline
   *  via createAttributeValue. */
  attributeValues: AttributeValue[];
}

interface EditModeProps extends CommonProps {
  mode: "edit";
  product: Product;
  /** Number of variants this product has — drives the zero-variant
   *  "default supplier" picker (mirrors how the price is a product-level
   *  default that seeds variants). */
  variantCount?: number;
  /** Active suppliers — for the zero-variant default-supplier picker. */
  suppliers: Supplier[];
  /**
   * Slot for the supplier-management section. Rendered between the
   * Pricing and Logistics sections so the conceptual flow is:
   *   Basic → Pricing → Suppliers (with their per-supplier cost) → Logistics → Visibility.
   * Passed as a slot rather than imported here so this form doesn't
   * need to know how supplier config works.
   */
  suppliersSlot?: ReactNode;
  /**
   * Slot for the categories editor — rendered at the BOTTOM of column 2.
   * Edit mode uses a separate component (ProductCategoriesEditor) with
   * its own server actions that update live on toggle.
   */
  categoriesSlot?: ReactNode;
  /** Called after a successful save — lets a host (e.g. the side panel)
   *  refetch its data so derived UI (the draft footer) re-validates. */
  onSaved?: () => void;
}

type Props = CreateModeProps | EditModeProps;

/**
 * Unified product form — handles BOTH the create flow (/admin/products/new)
 * and the edit-overview-tab flow (/admin/products/[id]/edit). Replaces the
 * previously-separate `ProductBasicForm` (edit-only) and
 * `QuickProductCreateForm` (create-only), eliminating drift between the
 * two surfaces.
 *
 * Mode determines:
 *   - Initial state (empty defaults vs. populated from product row)
 *   - The Βασικά section's `baseSku` field visibility (create only —
 *     variants own their SKUs after creation)
 *   - The slug auto-fill behavior (create auto-fills from name until
 *     the admin touches the slug field manually; edit never auto-fills)
 *   - The Categories section's render mode (inline checkbox grid in
 *     create vs. injected slot in edit)
 *   - The submit action (createProduct atomic call with variants[]
 *     vs. updateProduct partial patch)
 *   - The post-submit behavior (redirect to /edit?tab=variants in
 *     create vs. router.refresh in edit)
 *
 * Layout is identical in both modes:
 *   COL 1 (display / identity): Βασικά, Logistics, Ορατότητα
 *   COL 2 (commerce): Τιμολόγηση, [suppliersSlot in edit], Categories
 *
 * State is fully controlled (every field has its own useState) — chosen
 * over the previous edit-form FormData approach so the create-mode
 * slug-auto-fill + live net-price hint can react to keystrokes without
 * a separate state-tracking layer.
 */
export default function ProductForm(props: Props) {
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const product = isEdit ? props.product : null;
  // Drafts behave like create mode for slug purposes: the slug auto-derives
  // from the name (and the throwaway "draft-…" placeholder is hidden) until
  // the admin manually edits it.
  const isDraft = isEdit && !!product?.is_draft;
  // In edit mode `visibleSections` is irrelevant — the edit page shows
  // overview as its own route tab and variants as a separate page-
  // level tab, so this form only ever renders the overview portion
  // there. Default 'all' = render everything. In create mode the
  // coordinator passes the active tab key.
  const visibleSections: "all" | "overview" | "variants" | "images" = isEdit
    ? "all"
    : (props.visibleSections ?? "all");
  const showOverviewSections =
    visibleSections === "all" || visibleSections === "overview";
  const showVariantsSection =
    !isEdit && (visibleSections === "all" || visibleSections === "variants");
  // Images section is create-only — edit mode renders the Images tab
  // at the route level via /admin/products/[id]/edit?tab=images, not
  // through ProductForm.
  const showImagesSection = !isEdit && visibleSections === "images";

  // ─── State initialization ───────────────────────────────────────
  // All fields are controlled. In edit mode we seed from the product
  // row; in create mode we start with empty strings + sensible
  // defaults. This unification means the same render path can drive
  // both flows — the only diff is what's pre-filled.
  const [name, setName] = useState<string>(product?.name ?? "");
  const [slug, setSlug] = useState<string>(() => {
    const s = product?.slug ?? "";
    // Hide the draft placeholder so the slug auto-derives from the name.
    return isDraft && s.startsWith("draft-") ? "" : s;
  });
  // Tracks whether the admin has manually edited the slug — used to
  // suppress auto-fill in create mode AND for drafts. In edit mode for a
  // real product the slug never auto-fills (existing URLs are SEO-critical).
  const [slugUserEdited, setSlugUserEdited] = useState<boolean>(
    isEdit && !isDraft
  );
  const [brand, setBrand] = useState<string>(product?.brand ?? "");
  const [description, setDescription] = useState<string>(
    product?.description ?? ""
  );
  const [baseSku, setBaseSku] = useState<string>(product?.base_sku ?? "");
  const [ageMin, setAgeMin] = useState<string>(
    product?.age_min !== null && product?.age_min !== undefined
      ? String(product.age_min)
      : ""
  );
  const [ageMax, setAgeMax] = useState<string>(
    product?.age_max !== null && product?.age_max !== undefined
      ? String(product.age_max)
      : ""
  );

  // Pricing
  const [basePrice, setBasePrice] = useState<string>(
    product ? String(product.base_price) : ""
  );
  const [currency, setCurrency] = useState<string>(product?.currency ?? "EUR");
  const [vatRateId, setVatRateId] = useState<string>(
    product?.vat_rate_id ?? ""
  );

  // Logistics
  const [weightG, setWeightG] = useState<string>(
    product?.weight_g !== null && product?.weight_g !== undefined
      ? String(product.weight_g)
      : ""
  );
  const [lengthMm, setLengthMm] = useState<string>(
    product?.length_mm !== null && product?.length_mm !== undefined
      ? String(product.length_mm)
      : ""
  );
  const [widthMm, setWidthMm] = useState<string>(
    product?.width_mm !== null && product?.width_mm !== undefined
      ? String(product.width_mm)
      : ""
  );
  const [heightMm, setHeightMm] = useState<string>(
    product?.height_mm !== null && product?.height_mm !== undefined
      ? String(product.height_mm)
      : ""
  );
  const [volumetricPrefixId, setVolumetricPrefixId] = useState<string>(
    product?.volumetric_prefix_id ?? ""
  );

  // Visibility — binary in both modes. Null in the DB resolves to the
  // global default for the initial toggle state; once the admin
  // flips the toggle we always send an explicit boolean. The "inherit
  // global" semantic stays in the DB schema for back-compat but isn't
  // expressed in this UI by design (simpler binary matches the admin
  // mental model).
  const [active, setActive] = useState<boolean>(product?.active ?? true);
  const [showWhenOos, setShowWhenOos] = useState<boolean>(
    product?.show_when_oos !== null && product?.show_when_oos !== undefined
      ? product.show_when_oos
      : props.globalShowWhenOosDefault
  );

  // Create-mode-only: which categories to assign at creation time.
  // Edit mode uses ProductCategoriesEditor (slot-injected) with its
  // own add/remove server actions, so this set is unused there.
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    new Set()
  );

  // Create-mode-only: initial supplier link with optional unit cost.
  // Both fields optional — admin can create a product without any
  // supplier (rare but legal), or pick a supplier without typing a
  // cost yet (cost will be backfilled from products.cost_price or
  // set later in the Suppliers section). The combo means:
  //   - No supplier picked → no supplier_products rows
  //   - Supplier picked, no cost → supplier_products row with NULL cost
  //   - Supplier picked + cost typed → supplier_products row with cost
  const [initialSupplierId, setInitialSupplierId] = useState<string>(
    product?.default_supplier_id ?? ""
  );
  const [initialUnitCost, setInitialUnitCost] = useState<string>("");
  const [initialUnitCostCurrency, setInitialUnitCostCurrency] =
    useState<string>("EUR");

  // Create-mode-only: staged state captured from the three Variants-tab
  // components (AxesEditor + ProductSpecsPanel + SplitOverridesPanel
  // in mode='create'). Each component manages its own working state
  // internally; we just buffer the latest snapshot here via the
  // onChange callbacks. Submit aggregates all three into one
  // createProduct call.
  //
  // stagedVariants empty + admin clicks "Create Product" → ProductForm
  // submits a single attribute_combo=null variant using baseSku +
  // basePrice (explicit single-SKU product). The intentionality
  // requirement is still met: admin TYPED baseSku + basePrice (which
  // ARE the variant's description) and clicked Create. No silent
  // placeholder — the admin sees + commits.
  const [stagedVariants, setStagedVariants] = useState<ProductVariant[]>([]);
  const [stagedSpecs, setStagedSpecs] = useState<ProductSpecificationView[]>(
    []
  );
  const [stagedSplits, setStagedSplits] = useState<Record<string, boolean>>(
    {}
  );
  // Images-tab create-mode state: image_axes + staged images, both
  // collected client-side via the same Images-tab UI as edit mode.
  // tempProductId is a client-generated UUID used as the storage_key
  // prefix for uploads — it never references a real DB row. Stable
  // across the entire create-form session via useRef.
  const tempProductIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "00000000-0000-0000-0000-000000000000"
  );
  const [stagedImageAxes, setStagedImageAxes] = useState<string[]>([]);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);

  // Revoke all blob URLs when the component unmounts so the in-memory
  // image bytes can be GC'd. Without this, abandoning the create form
  // leaves the blobs in memory until the page is closed.
  useEffect(() => {
    return () => {
      for (const s of stagedImages) {
        try {
          URL.revokeObjectURL(s.blobUrl);
        } catch {
          // best-effort
        }
      }
    };
    // Intentional: capture latest stagedImages at unmount time. The
    // effect re-runs whenever the list changes so the cleanup always
    // has access to current blobUrls.
  }, [stagedImages]);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // ── Autosave (edit/panel mode only) ──────────────────────────────
  // The overview is panel-only now and the rest of the panel autosaves,
  // so the overview autosaves too: no explicit "Save" button. Last-write-
  // wins (single admin, panel-scoped) — no optimistic lock.
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveMounted = useRef(false);

  // ─── Slug auto-fill (create mode only) ──────────────────────────
  function handleNameChange(v: string) {
    setName(v);
    if ((props.mode === "create" || isDraft) && !slugUserEdited) {
      setSlug(slugify(v));
    }
  }
  function handleSlugChange(v: string) {
    setSlug(v);
    setSlugUserEdited(true);
  }

  // ── Edit-mode save (autosave + Enter) ─────────────────────────────
  // Persists the overview fields. `silent` (autosave) skips error surfacing
  // for transient invalid states (mid-typing); the explicit path (Enter)
  // shows them. No optimistic lock — autosave is last-write-wins.
  async function saveEdit(silent: boolean) {
    if (!isEdit || !product) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      if (!silent) setError("Συμπληρώστε όνομα.");
      return;
    }
    const priceNum = Number(basePrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      if (!silent) setError("Μη έγκυρη τιμή πώλησης.");
      return;
    }
    const parseOptInt = (raw: string, label: string, max?: number) => {
      if (raw.trim() === "") return undefined;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || (max !== undefined && n > max)) {
        throw new Error(
          `Μη έγκυρη τιμή για ${label}${max !== undefined ? ` (0-${max})` : ""}.`
        );
      }
      return n;
    };
    let weightNum: number | undefined;
    let lengthNum: number | undefined;
    let widthNum: number | undefined;
    let heightNum: number | undefined;
    let ageMinNum: number | undefined;
    let ageMaxNum: number | undefined;
    try {
      weightNum = parseOptInt(weightG, "βάρος");
      lengthNum = parseOptInt(lengthMm, "μήκος");
      widthNum = parseOptInt(widthMm, "πλάτος");
      heightNum = parseOptInt(heightMm, "ύψος");
      ageMinNum = parseOptInt(ageMin, "ηλικία (από)", 99);
      ageMaxNum = parseOptInt(ageMax, "ηλικία (έως)", 99);
    } catch (err) {
      if (!silent)
        setError(err instanceof Error ? err.message : "Μη έγκυρα αριθμητικά πεδία.");
      return;
    }
    if (
      ageMinNum !== undefined &&
      ageMaxNum !== undefined &&
      ageMinNum > ageMaxNum
    ) {
      if (!silent) setError("Η ελάχιστη ηλικία δεν μπορεί να ξεπερνά τη μέγιστη.");
      return;
    }

    setError(null);
    setSaving(true);
    const r = await updateProduct({
      id: product.id,
      name: trimmedName,
      slug: (slug.trim() || (isDraft ? slugify(trimmedName) : "")) || undefined,
      description: description || undefined,
      basePrice: priceNum,
      currency,
      weightG: weightNum,
      lengthMm: lengthNum ?? null,
      widthMm: widthNum ?? null,
      heightMm: heightNum ?? null,
      volumetricPrefixId: volumetricPrefixId || null,
      ageMin: ageMinNum,
      ageMax: ageMaxNum,
      brand: brand || undefined,
      baseSku: baseSku.trim() || null,
      // Product-level default supplier — the template that seeds each
      // variant's preferred supplier on creation (mirrors base_price).
      defaultSupplierId: initialSupplierId || null,
      active,
      vatRateId: vatRateId || null,
      showWhenOos,
    });
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setSavedAt(Date.now());
    if (props.mode === "edit") props.onSaved?.();
  }

  // Debounced autosave — fires ~700ms after the last overview edit. Skips
  // the initial mount so loading a product doesn't trigger a write.
  useEffect(() => {
    if (!isEdit) return;
    if (!autosaveMounted.current) {
      autosaveMounted.current = true;
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void saveEdit(true);
    }, 700);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // saveEdit intentionally omitted — it closes over current state each
    // render; the timer always runs the latest scheduled closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isEdit,
    name,
    slug,
    description,
    basePrice,
    currency,
    weightG,
    lengthMm,
    widthMm,
    heightMm,
    volumetricPrefixId,
    ageMin,
    ageMax,
    brand,
    baseSku,
    initialSupplierId,
    active,
    vatRateId,
    showWhenOos,
  ]);

  function toggleCategory(id: string) {
    setSelectedCategoryIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── Submit ─────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Edit mode (panel) autosaves — Enter just flushes immediately.
    if (isEdit) {
      void saveEdit(false);
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Συμπληρώστε όνομα.");
      return;
    }
    const priceNum = Number(basePrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("Μη έγκυρη τιμή πώλησης.");
      return;
    }

    // Optional numeric fields — only validate when entered. Returns
    // undefined for empty strings (sent as undefined to the action,
    // which preserves "not specified" vs. "explicitly zero").
    function parseOptInt(raw: string, label: string, max?: number) {
      if (raw.trim() === "") return undefined;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || (max !== undefined && n > max)) {
        throw new Error(
          `Μη έγκυρη τιμή για ${label}${max !== undefined ? ` (0-${max})` : ""}.`
        );
      }
      return n;
    }

    let weightNum: number | undefined;
    let lengthNum: number | undefined;
    let widthNum: number | undefined;
    let heightNum: number | undefined;
    let ageMinNum: number | undefined;
    let ageMaxNum: number | undefined;
    try {
      weightNum = parseOptInt(weightG, "βάρος");
      lengthNum = parseOptInt(lengthMm, "μήκος");
      widthNum = parseOptInt(widthMm, "πλάτος");
      heightNum = parseOptInt(heightMm, "ύψος");
      ageMinNum = parseOptInt(ageMin, "ηλικία (από)", 99);
      ageMaxNum = parseOptInt(ageMax, "ηλικία (έως)", 99);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Μη έγκυρα αριθμητικά πεδία.");
      return;
    }
    if (
      ageMinNum !== undefined &&
      ageMaxNum !== undefined &&
      ageMinNum > ageMaxNum
    ) {
      setError("Η ελάχιστη ηλικία δεν μπορεί να ξεπερνά τη μέγιστη.");
      return;
    }

    startTransition(async () => {
      if (props.mode === "create") {
        // Create: validate baseSku + variants, atomically create
        // product + all variants. NO placeholder variants — the
        // admin explicitly described the variant set (either a
        // single-SKU product OR a multi-axis matrix). createProduct
        // requires variants.length >= 1; that's now enforced by the
        // UI ("Save" disabled until at least one combo is defined).
        const skuTrim = baseSku.trim();
        if (!skuTrim) {
          setError("Συμπληρώστε βασικό SKU.");
          return;
        }
        const slugTrim = slug.trim() || slugify(trimmedName);
        if (!slugTrim) {
          setError(
            "Μη έγκυρο slug — το όνομα δεν περιέχει χαρακτήρες που μπορούν να μετατραπούν σε URL."
          );
          return;
        }
        // Build the variants[] payload from staged variants. Two
        // sources:
        //   - AxesEditor (mode='create') emits one ProductVariant per
        //     combo into `stagedVariants` via onVariantsChange.
        //   - When the admin doesn't add any axes (empty stagedVariants
        //     at submit time), we send a single attribute_combo=null
        //     variant using baseSku+basePrice — this is the EXPLICIT
        //     single-SKU product path. Admin saw baseSku + basePrice
        //     in the Overview tab; this submit confirms it.
        //
        // Either way createProduct's Zod schema (variants.min(1)) +
        // the DB constraint trigger guarantee no orphan products.
        const variantSpecs: Array<{
          sku: string;
          price: number;
          attributeCombo: Record<string, string> | null;
          isActive: boolean;
        }> =
          stagedVariants.length === 0
            ? [
                {
                  sku: skuTrim,
                  price: priceNum,
                  attributeCombo: null,
                  isActive: true,
                },
              ]
            : stagedVariants.map((v) => ({
                sku: v.sku,
                price: Number(v.price),
                attributeCombo: v.attribute_combo,
                isActive: v.is_active,
              }));
        // Resolve the initial cost cleanly: if both supplier AND cost
        // are entered, send both; otherwise send neither. The action
        // schema mirrors the supplier_products CHECK constraint
        // (cost+currency together or both null).
        const trimmedCost = initialUnitCost.trim();
        const initialCostNum =
          initialSupplierId && trimmedCost !== ""
            ? Number(trimmedCost)
            : undefined;
        if (
          initialCostNum !== undefined &&
          (!Number.isFinite(initialCostNum) || initialCostNum < 0)
        ) {
          setError("Μη έγκυρο κόστος μονάδας προμηθευτή.");
          return;
        }
        const r = await createProduct({
          name: trimmedName,
          slug: slugTrim,
          description: description.trim() || undefined,
          basePrice: priceNum,
          currency,
          baseSku: skuTrim,
          brand: brand.trim() || undefined,
          weightG: weightNum,
          lengthMm: lengthNum ?? null,
          widthMm: widthNum ?? null,
          heightMm: heightNum ?? null,
          volumetricPrefixId: volumetricPrefixId || null,
          ageMin: ageMinNum,
          ageMax: ageMaxNum,
          active,
          showWhenOos,
          vatRateId: vatRateId || null,
          defaultSupplierId: initialSupplierId || null,
          initialUnitCost: initialCostNum ?? null,
          initialUnitCostCurrency:
            initialCostNum !== undefined ? initialUnitCostCurrency : null,
          categoryIds:
            selectedCategoryIds.size > 0
              ? Array.from(selectedCategoryIds)
              : undefined,
          variants: variantSpecs,
          // Staged from ProductSpecsPanel (create mode). The action
          // strips the local synthetic ids and inserts into
          // product_specifications in the same transaction.
          productSpecs:
            stagedSpecs.length > 0
              ? stagedSpecs.map((s) => ({
                  attributeId: s.attribute_id,
                  value: s.value,
                }))
              : undefined,
          // Staged from SplitOverridesPanel (create mode).
          splitOverrides:
            Object.keys(stagedSplits).length > 0 ? stagedSplits : null,
          // Image-affecting axes — selected via ProductImageAxesSelector
          // inside the Images tab. Lands in products.image_axes.
          imageAxes: stagedImageAxes,
          // Staged from the Images tab (create mode). Each entry's
          // bytes already live in storage under the tempProductId
          // prefix; createProduct now inserts the matching media_assets
          // + product_images rows so they appear on the edit page
          // immediately after redirect.
          stagedImages: stagedImages.map((s) => ({
            storageKey: s.storageKey,
            bucket: s.bucket,
            sizeBytes: s.sizeBytes,
            attributeCombo: s.attributeCombo,
            altText: s.altText ?? undefined,
            isCover: s.isCover,
            displayOrder: s.displayOrder,
          })),
        });
        if (!r.success) {
          setError(r.error);
          return;
        }
        // Product + variants + specs + splits all committed atomically.
        // Land on the products list with the new product's panel open so
        // the admin can review the matrix and iterate (the edit page was
        // retired — the panel is the editor).
        router.push(`/admin/products?focus=${r.data.id}`);
        router.refresh();
        return;
      }
      // Edit mode never reaches here — it returns early to saveEdit() above.
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-7xl">
      {/* 2-column grid (lg+). Sections are manually assigned to
          col 1 or col 2 so we control the reading order on wide
          screens. items-start keeps each section sized to its own
          content (no whitespace inflation to match column-sibling
          heights). On screens <1024px the columns collapse to a
          single stack in natural DOM order. */}
      {showOverviewSections && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        {/* ══════════ COLUMN 1 ══════════ */}
        <div className="space-y-5">

          {/* ─── Section: Βασικά ───────────────────────────────── */}
          <section className="cms-card-section space-y-5">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Info className="w-4 h-4" />
                Βασικά
              </h2>
              <p className="text-sm text-foreground/70 mt-1.5">
                {isEdit
                  ? "Όνομα, ταυτότητα και βασική περιγραφή του προϊόντος."
                  : "Όνομα, slug URL, μοναδικό SKU και βασικά στοιχεία προϊόντος."}
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block md:col-span-2">
                <span className="block text-sm font-medium mb-1.5">Όνομα *</span>
                <input
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder={
                    isEdit
                      ? undefined
                      : "π.χ. Βαπτιστικό σνίκερ Babywalker"
                  }
                  className="cms-input"
                />
              </label>

              <label className="block">
                <span className="block text-sm font-medium mb-1.5">
                  Slug {isEdit && !isDraft ? "" : "(URL)"}
                </span>
                <input
                  required={!isEdit}
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder={
                    isEdit && !isDraft ? undefined : "auto-fill από το όνομα"
                  }
                  className="cms-input font-mono lowercase"
                />
                {(!isEdit || isDraft) && (
                  <span className="block text-xs text-muted-foreground mt-1">
                    Δημιουργείται αυτόματα από το όνομα. Επεξεργάσιμο.
                  </span>
                )}
              </label>

              {/* Base SKU — the product-level SKU prefix (products.base_sku).
                  Shown in every mode: it's the same value the products table
                  edits inline, and drafts REQUIRE it to be finalised. Variant
                  SKUs are edited separately in the Παραλλαγές tab. */}
              <label className="block">
                <span className="block text-sm font-medium mb-1.5">
                  Βασικό SKU {isEdit ? "" : "*"}
                </span>
                <input
                  required={!isEdit}
                  value={baseSku}
                  onChange={(e) => setBaseSku(e.target.value)}
                  placeholder="π.χ. KID-SNEAKER-001"
                  className="cms-input font-mono uppercase"
                />
                <span className="block text-xs text-muted-foreground mt-1">
                  Πρόθεμα για τα SKU των παραλλαγών. Επιλογή σας — δεν
                  παράγεται αυτόματα.
                </span>
              </label>

              <label className="block">
                <span className="block text-sm font-medium mb-1.5">Μάρκα</span>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder={isEdit ? undefined : "π.χ. Babywalker"}
                  className="cms-input"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="block text-sm font-medium mb-1.5">
                  Περιγραφή
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder={
                    isEdit ? undefined : "Σύντομη περιγραφή προϊόντος…"
                  }
                  className="cms-input"
                  style={{ height: "auto", minHeight: "6rem" }}
                />
              </label>

              {/* Combined age-range field — single conceptual field
                  with two number inputs separated by a dash. */}
              <div className="block">
                <span className="block text-sm font-medium mb-1.5">
                  Ηλικιακό εύρος
                </span>
                <div className="cms-input flex items-center gap-2 px-2.5 py-0 focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                    placeholder="—"
                    aria-label="Ηλικία ελάχιστη"
                    className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
                  />
                  <span className="text-muted-foreground font-bold select-none">
                    –
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                    placeholder="—"
                    aria-label="Ηλικία μέγιστη"
                    className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
                  />
                  <span className="text-xs text-muted-foreground select-none pr-1">
                    ετών
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Section: Logistics ─────────────────────────────── */}
          <section className="cms-card-section space-y-5">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Logistics
              </h2>
              <p className="text-sm text-foreground/70 mt-1.5">
                Βάρος, διαστάσεις και κατηγορία μεγέθους — χρησιμοποιούνται
                από τους couriers για υπολογισμό μεταφορικών.
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium mb-1.5">
                  Βάρος (g)
                </span>
                <input
                  type="number"
                  min={0}
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  placeholder="—"
                  className="cms-input font-mono"
                />
              </label>

              {/* L × W × H fused control with × separators. */}
              <div className="block">
                <span className="block text-sm font-medium mb-1.5">
                  Διαστάσεις πακέτου (mm){" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    · Μ × Π × Υ
                  </span>
                </span>
                <div className="cms-input flex items-center gap-2 px-2.5 py-0 focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15">
                  <input
                    type="number"
                    min={1}
                    value={lengthMm}
                    onChange={(e) => setLengthMm(e.target.value)}
                    placeholder="μήκος"
                    aria-label="Μήκος (mm)"
                    className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
                  />
                  <span className="text-muted-foreground select-none">×</span>
                  <input
                    type="number"
                    min={1}
                    value={widthMm}
                    onChange={(e) => setWidthMm(e.target.value)}
                    placeholder="πλάτος"
                    aria-label="Πλάτος (mm)"
                    className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
                  />
                  <span className="text-muted-foreground select-none">×</span>
                  <input
                    type="number"
                    min={1}
                    value={heightMm}
                    onChange={(e) => setHeightMm(e.target.value)}
                    placeholder="ύψος"
                    aria-label="Ύψος (mm)"
                    className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
                  />
                </div>
              </div>

              {/* Volumetric prefix — spans both cols because its
                  description line is verbose. Categorical size class
                  used by locker couriers. Independent of raw L×W×H. */}
              {props.volumetricPrefixes.length > 0 && (
                <label className="block md:col-span-2">
                  <span className="block text-sm font-medium mb-1.5">
                    Κατηγορία μεγέθους{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      (για locker couriers)
                    </span>
                  </span>
                  <select
                    value={volumetricPrefixId}
                    onChange={(e) => setVolumetricPrefixId(e.target.value)}
                    className="cms-input"
                  >
                    <option value="">— χωρίς κατηγορία —</option>
                    {props.volumetricPrefixes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                        {p.max_weight_g
                          ? ` · έως ${
                              p.max_weight_g < 1000
                                ? `${p.max_weight_g}g`
                                : `${(p.max_weight_g / 1000).toFixed(
                                    p.max_weight_g % 1000 === 0 ? 0 : 2
                                  )}kg`
                            }`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Επιλέξτε αν το προϊόν χωράει σε μία τυποποιημένη
                    κατηγορία μεγέθους που χρησιμοποιεί κάποιος courier
                    (π.χ. BoxNow Small). Διαχείριση κατηγοριών:{" "}
                    <a
                      href="/admin/settings/couriers?tab=prefixes"
                      className="underline hover:text-foreground"
                    >
                      Couriers → Μεγέθη πακέτου
                    </a>
                    .
                  </p>
                </label>
              )}
            </div>
          </section>

          {/* ─── Section: Ορατότητα ─────────────────────────────── */}
          <section className="cms-card-section">
            <header className="pb-3 mb-4 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Ορατότητα
              </h2>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-start justify-between gap-3 rounded-md border border-foreground/15 bg-background px-4 py-3 cursor-pointer hover:bg-card transition-colors">
                <div>
                  <p className="text-sm font-medium">Ενεργό</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isEdit
                      ? "Ορατό στο κατάστημα."
                      : "Αν είναι ενεργό, εμφανίζεται στο storefront."}
                  </p>
                </div>
                <Toggle
                  checked={active}
                  onChange={setActive}
                  size="sm"
                  ariaLabel="Ενεργό προϊόν"
                />
              </label>

              <label className="flex items-start justify-between gap-3 rounded-md border border-foreground/15 bg-background px-4 py-3 cursor-pointer hover:bg-card transition-colors">
                <div>
                  <p className="text-sm font-medium">Ορατό όταν εξαντλείται</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Κρατά το προϊόν στο storefront όταν είναι σε μηδενικό
                    απόθεμα (για wishlist + ειδοποιήσεις).
                  </p>
                </div>
                <Toggle
                  checked={showWhenOos}
                  onChange={setShowWhenOos}
                  size="sm"
                  ariaLabel="Ορατό όταν εξαντλείται"
                />
              </label>
            </div>
          </section>
        </div>{/* end of COLUMN 1 */}

        {/* ══════════ COLUMN 2 ══════════ */}
        <div className="space-y-5">

          {/* ─── Section: Τιμολόγηση ───────────────────────────── */}
          <section className="cms-card-section space-y-5">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Τιμολόγηση
              </h2>
              <p className="text-sm text-foreground/70 mt-1.5">
                Τιμή πώλησης και κατηγορία ΦΠΑ. Το κόστος μονάδας
                ορίζεται ανά προμηθευτή στην ενότητα «Προμηθευτές»
                {isEdit ? "." : " μετά τη δημιουργία."}
              </p>
            </header>

            {/* Pricing row: Βασική τιμή (compact) | Μετά ΦΠΑ (live
                readout) | Κατηγορία ΦΠΑ. Three side-by-side inline
                blocks so the price-input, its VAT-stripped
                equivalent, and the VAT picker read as one row of
                "the price story". Wraps on narrow viewports. */}
            <div className="flex flex-wrap items-end gap-4">
              {/* — Βασική τιμή — */}
              <div className="block">
                <span className="block text-sm font-medium mb-1.5">
                  Βασική τιμή *
                </span>
                <div className="flex items-stretch h-10 w-[160px] rounded-md border border-foreground/20 bg-background overflow-hidden transition-colors focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    className="flex-1 min-w-0 font-mono text-right bg-transparent border-0 outline-none focus:ring-0 px-2 text-sm"
                  />
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="border-0 border-l border-foreground/20 bg-muted/50 font-mono uppercase text-xs px-1.5 outline-none focus:ring-0 cursor-pointer hover:bg-muted/70 transition-colors"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* — Μετά ΦΠΑ (live readout) — */}
              <div className="block">
                <span className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  Μετά ΦΠΑ
                </span>
                <div className="h-10 inline-flex items-center px-3 rounded-md border border-foreground/10 bg-muted/30 min-w-[140px]">
                  {(() => {
                    const price = Number(basePrice);
                    if (!Number.isFinite(price) || price <= 0) {
                      return (
                        <span className="text-muted-foreground/60 font-mono text-base">
                          —
                        </span>
                      );
                    }
                    const effective =
                      props.vatRates.find((r) => r.id === vatRateId) ??
                      props.vatRates.find((r) => r.is_default) ??
                      null;
                    if (!effective) {
                      return (
                        <span className="text-muted-foreground/60 font-mono text-base">
                          —
                        </span>
                      );
                    }
                    const net = price / (1 + effective.rate);
                    return (
                      <span
                        className="font-mono tabular-nums text-base text-foreground"
                        title={`Καθαρή τιμή χωρίς ΦΠΑ ${(effective.rate * 100).toFixed(0)}%. Οι τιμές στο κατάστημα εμφανίζονται με ΦΠΑ συμπεριλαμβανόμενο.`}
                      >
                        {net.toFixed(2)} {currency}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* — Κατηγορία ΦΠΑ — */}
              <label className="block flex-1 min-w-[200px] max-w-[280px]">
                <span className="block text-sm font-medium mb-1.5">
                  Κατηγορία ΦΠΑ
                  <span className="text-xs text-muted-foreground font-normal ml-1.5">
                    (παράκαμψη)
                  </span>
                </span>
                <select
                  value={vatRateId}
                  onChange={(e) => setVatRateId(e.target.value)}
                  className="cms-input"
                >
                  <option value="">
                    {(() => {
                      const sysDefault = props.vatRates.find((r) => r.is_default);
                      return sysDefault
                        ? `${(sysDefault.rate * 100).toFixed(0)}% (Προεπιλογή συστήματος)`
                        : "— χρήση κατηγορίας/προεπιλογής —";
                    })()}
                  </option>
                  {props.vatRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({(r.rate * 100).toFixed(2)}%)
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* Variants section moved OUT of COL 2 — see the
              showVariantsSection gate below the 2-col grid.
              The Variants tab in the create flow needs full-width
              real estate (matrix tables, axis chips). When the
              create coordinator passes visibleSections="variants"
              we want JUST that section to render, full-width;
              keeping it nested in COL 2 would constrain it. */}

          {/* Suppliers — different render per mode:
              - Edit: slot-injected ProductSuppliersSection with full
                per-variant editor, lives per-row in a table
              - Create: a SINGLE "Initial supplier" picker (defaultSupplierId
                + unit cost). The product has one placeholder variant
                at create time so showing a per-variant table here
                would be misleading. The picked supplier+cost is
                propagated to every new variant by addMatrixCombos
                when the admin later expands into axes (see that
                action for the propagation logic). */}
          {isEdit ? (
            // Mirror the price model: with no variants yet, edit the
            // PRODUCT-level default supplier (default_supplier_id) — it
            // seeds each variant's preferred supplier on creation. Once
            // variants exist, the per-variant section takes over.
            (props.variantCount ?? 0) === 0 ? (
              props.suppliers.length > 0 ? (
                <section className="cms-card-section space-y-4">
                  <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
                    <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                      <Truck className="w-4 h-4" />
                      Προμηθευτής (προεπιλογή)
                    </h2>
                    <p className="text-sm text-foreground/70 mt-1.5 max-w-2xl">
                      Επιλέξτε τον προτιμώμενο προμηθευτή τώρα — θα ανατεθεί
                      αυτόματα στις παραλλαγές μόλις τις δημιουργήσετε. Κόστος
                      και ανά-παραλλαγή ρυθμίσεις ορίζονται στη συνέχεια.
                    </p>
                  </header>
                  <label className="block max-w-[320px]">
                    <span className="block text-sm font-medium mb-1.5">
                      Προμηθευτής
                    </span>
                    <select
                      value={initialSupplierId}
                      onChange={(e) => setInitialSupplierId(e.target.value)}
                      className="cms-input"
                    >
                      <option value="">— κανένας —</option>
                      {props.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              ) : null
            ) : (
              props.suppliersSlot
            )
          ) : props.suppliers.length > 0 ? (
            <section className="cms-card-section space-y-5">
              <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
                <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                  <Truck className="w-4 h-4" />
                  Αρχικός προμηθευτής
                </h2>
                <p className="text-sm text-foreground/70 mt-1.5">
                  Προαιρετικά: επιλέξτε τον προτιμώμενο προμηθευτή και
                  το κόστος μονάδας. Θα ανατεθεί ως προεπιλογή σε όλες
                  τις παραλλαγές που θα δημιουργηθούν για αυτό το προϊόν.
                </p>
              </header>

              <div className="flex flex-wrap items-end gap-4">
                {/* — Supplier picker — */}
                <label className="block flex-1 min-w-[220px] max-w-[320px]">
                  <span className="block text-sm font-medium mb-1.5">
                    Προμηθευτής
                  </span>
                  <select
                    value={initialSupplierId}
                    onChange={(e) => {
                      setInitialSupplierId(e.target.value);
                      // Auto-fill the cost currency from the supplier's
                      // default_currency on first selection — saves the
                      // admin a step in the common case where the
                      // supplier invoices in their default currency.
                      if (e.target.value) {
                        const s = props.suppliers.find(
                          (x) => x.id === e.target.value
                        );
                        if (s) setInitialUnitCostCurrency(s.default_currency);
                      }
                    }}
                    className="cms-input"
                  >
                    <option value="">— κανένας στο ξεκίνημα —</option>
                    {props.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                {/* — Unit cost + currency — fused control, same shape
                    as Βασική τιμή for visual consistency. Disabled
                    when no supplier is picked. */}
                <div className="block">
                  <span
                    className={`block text-sm font-medium mb-1.5 ${
                      initialSupplierId ? "" : "text-muted-foreground"
                    }`}
                  >
                    Κόστος μονάδας
                  </span>
                  <div
                    className={`flex items-stretch h-10 w-[180px] rounded-md border bg-background overflow-hidden transition-colors ${
                      initialSupplierId
                        ? "border-foreground/20 focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15"
                        : "border-foreground/10 opacity-60"
                    }`}
                  >
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={initialUnitCost}
                      onChange={(e) => setInitialUnitCost(e.target.value)}
                      disabled={!initialSupplierId}
                      placeholder="—"
                      className="flex-1 min-w-0 font-mono text-right bg-transparent border-0 outline-none focus:ring-0 px-2 text-sm disabled:cursor-not-allowed"
                    />
                    <select
                      value={initialUnitCostCurrency}
                      onChange={(e) =>
                        setInitialUnitCostCurrency(e.target.value)
                      }
                      disabled={!initialSupplierId}
                      className="border-0 border-l border-foreground/20 bg-muted/50 font-mono uppercase text-xs px-1.5 outline-none focus:ring-0 cursor-pointer hover:bg-muted/70 transition-colors disabled:cursor-not-allowed"
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    {initialSupplierId
                      ? "Προαιρετικό — αν δεν συμπληρωθεί τώρα, μπορείτε αργότερα."
                      : "Επιλέξτε πρώτα προμηθευτή."}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {/* Categories — different render path per mode:
              - Edit: slot-injected ProductCategoriesEditor with its
                own live add/remove server actions
              - Create: inline checkbox grid that bundles category
                IDs into the createProduct call */}
          {isEdit ? (
            props.categoriesSlot
          ) : props.categories.length > 0 ? (
            <section className="cms-card-section space-y-4">
              <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
                <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Κατηγορίες
                </h2>
                <p className="text-sm text-foreground/70 mt-1.5">
                  Επιλέξτε τις κατηγορίες στις οποίες θα εμφανίζεται το
                  προϊόν.
                </p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {props.categories.map((cat) => {
                  const checked = selectedCategoryIds.has(cat.id);
                  return (
                    <label
                      key={cat.id}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors bg-background ${
                        checked
                          ? "border-foreground/40 bg-muted/30"
                          : "border-foreground/15 hover:border-foreground/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(cat.id)}
                        className="shrink-0"
                      />
                      <span className="text-sm">{cat.name}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      )}

      {/* Variants section — full-width, outside the 2-col grid.
          Renders ONLY in create mode and only when the active tab is
          Παραλλαγές (or 'all', which legacy/dev callers might pass).
          The section refuses to let the form save without ≥1 valid
          variant: either the explicit single-SKU "use baseSku"
          fallback, or at least one combo from staged axes. */}
      {showVariantsSection && !isEdit && (
        <div className="space-y-6">
          {/* Lead-in: single-SKU fallback note. When no axes are
              staged AND no variants exist yet, ProductForm submits a
              single attribute_combo=null variant using baseSku +
              basePrice. The admin SEES this commitment before
              clicking Create Product — no silent placeholder. */}
          {stagedVariants.length === 0 && (
            <div className="rounded-md border border-foreground/15 bg-muted/30 px-4 py-3">
              <p className="text-sm">
                <span className="font-medium">Απλό προϊόν χωρίς άξονες:</span>{" "}
                θα δημιουργηθεί{" "}
                <strong>1 παραλλαγή</strong> με SKU{" "}
                <span className="font-mono text-foreground">
                  {baseSku.trim() || "<συμπληρώστε στα Βασικά>"}
                </span>
                {basePrice && (
                  <>
                    {" "}
                    @ {basePrice} {currency}
                  </>
                )}
                .
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Προσθέστε άξονες παρακάτω για πολλαπλές παραλλαγές
                (χρώμα, μέγεθος, κ.λπ.).
              </p>
            </div>
          )}

          {/* AxesEditor (mode='create') — same component the edit
              page renders in its Variants tab. In create mode it
              holds staged variants locally and pushes them up via
              onVariantsChange. We pass empty initialVariants so the
              editor starts fresh. */}
          <AxesEditor
            mode="create"
            initialVariants={[]}
            initialAttributes={
              props.mode === "create" ? props.attributes : []
            }
            initialAttributeValues={
              props.mode === "create" ? props.attributeValues : []
            }
            basePrice={Number(basePrice) || 0}
            baseSku={baseSku.trim() || "SKU"}
            onVariantsChange={setStagedVariants}
          />

          {/* ProductSpecsPanel (mode='create') — same component the
              edit Variants tab renders. Staged specs flow up via
              onSpecsChange and get inserted in the same transaction
              as the product (see createProduct's productSpecs
              handling). */}
          <ProductSpecsPanel
            mode="create"
            initial={[]}
            attributes={props.mode === "create" ? props.attributes : []}
            attributeValues={
              props.mode === "create" ? props.attributeValues : []
            }
            variantAttributeSlugs={(() => {
              const set = new Set<string>();
              for (const v of stagedVariants) {
                if (!v.attribute_combo) continue;
                for (const slug of Object.keys(v.attribute_combo)) {
                  set.add(slug);
                }
              }
              return Array.from(set);
            })()}
            onSpecsChange={setStagedSpecs}
          />

          {/* SplitOverridesPanel (mode='create') — same edit-tab
              component. Empty when no axes yet (the panel itself
              renders a "no axes" placeholder). */}
          <SplitOverridesPanel
            mode="create"
            attributes={props.mode === "create" ? props.attributes : []}
            variants={stagedVariants}
            initialOverrides={null}
            onOverridesChange={setStagedSplits}
          />
        </div>
      )}

      {/* Create-mode Images tab — same UI as the edit page's Images tab.
          Uses the staged orchestrator: uploads put bytes in storage
          under tempProductId prefix; createProduct on submit inserts
          the matching media_assets + product_images rows atomically.
          Visible only when this tab is active (visibleSections='images')
          to avoid mounting the dnd-kit + storage chain on every render
          of the overview/variants tabs. */}
      {showImagesSection && props.mode === "create" && (
        <div className="space-y-6">
          <ProductImagesComboTab
            mode="create"
            tempProductId={tempProductIdRef.current}
            productName={name || "Νέο προϊόν"}
            imageAxes={stagedImageAxes}
            onImageAxesChange={setStagedImageAxes}
            stagedImages={stagedImages}
            onStagedImagesChange={setStagedImages}
            variants={stagedVariants}
            attributes={props.attributes}
            attributeValues={props.attributeValues}
          />
          {stagedVariants.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center px-4 py-6 rounded-md bg-muted/30 border border-foreground/10">
              Συμβουλή: για να ξεχωρίζουν οι εικόνες ανά παραλλαγή (π.χ.
              ανά χρώμα), προσθέστε πρώτα τους άξονες παραλλαγής στην
              καρτέλα «Παραλλαγές». Διαφορετικά οι εικόνες θα ισχύουν
              για όλες τις παραλλαγές.
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      {/* Submit row.
          - Edit mode → sticky-bottom "Αποθήκευση αλλαγών" button.
          - Create mode + visibleSections='overview' → "Next Step —
            Add Variants" CTA. Calls props.onNextStep() to advance
            the tab. Disabled until basics + price + currency are
            valid (a stable subset; full validation happens at the
            submit step on the variants tab).
          - Create mode + visibleSections='variants' → "Create Product"
            CTA. Submits the form. Disabled until at least one valid
            variant is described (no empty axes, ≥1 active combo).
          - Create mode + visibleSections='all' (legacy) → single
            "Δημιουργία προϊόντος" submit button. */}
      {(() => {
        // Overview-tab validity: name + baseSku + base price.
        const overviewValid =
          name.trim().length > 0 &&
          baseSku.trim().length > 0 &&
          basePrice.trim() !== "" &&
          Number(basePrice) > 0;
        // Variants-tab validity: at least one variant will be created.
        // Either the admin staged variants via AxesEditor
        // (stagedVariants.length >= 1) OR no staging at all → single
        // SKU fallback (covered by overviewValid since baseSku +
        // basePrice carry it). Both paths require overview valid.
        const variantsValid = overviewValid;

        if (isEdit) {
          // Autosave — no button. Show a quiet status line instead.
          return (
            <div className="flex justify-center pt-1 text-xs text-muted-foreground">
              {saving ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin"
                    aria-hidden
                  />
                  Αποθήκευση…
                </span>
              ) : savedAt ? (
                <span>Οι αλλαγές αποθηκεύονται αυτόματα ✓</span>
              ) : (
                <span>Οι αλλαγές αποθηκεύονται αυτόματα</span>
              )}
            </div>
          );
        }

        // Create-mode tab order: overview → variants → images → submit.
        // The next-step button advances one tab at a time. The final
        // submit only shows on the Images tab (last step). Bypass the
        // intermediate steps via direct tab clicks in the strip is
        // still allowed — but the gated CTA in this footer always
        // marches forward in the canonical order.
        if (visibleSections === "overview" && props.onNextStep) {
          return (
            <div className="flex justify-center sticky bottom-4 pt-2">
              <button
                type="button"
                onClick={props.onNextStep}
                disabled={isPending || !overviewValid}
                className="btn btn-primary btn-md shadow-md"
                title={
                  overviewValid
                    ? "Συνεχίστε στην ενότητα Παραλλαγές"
                    : "Συμπληρώστε όνομα, βασικό SKU και τιμή πρώτα"
                }
              >
                Επόμενο Βήμα — Παραλλαγές →
              </button>
            </div>
          );
        }

        if (visibleSections === "variants" && props.onNextStep) {
          return (
            <div className="flex justify-center sticky bottom-4 pt-2">
              <button
                type="button"
                onClick={props.onNextStep}
                disabled={isPending || !variantsValid}
                className="btn btn-primary btn-md shadow-md"
                title={
                  variantsValid
                    ? "Συνεχίστε στην ενότητα Φωτογραφίες"
                    : "Περιγράψτε τουλάχιστον μία παραλλαγή πρώτα"
                }
              >
                Επόμενο Βήμα — Φωτογραφίες →
              </button>
            </div>
          );
        }

        // visibleSections='images' (last step) OR 'all' (legacy
        // single-page mode) → actual submit. The Images tab is now
        // the final step in the create flow; clicking the CTA there
        // calls createProduct with everything staged so far.
        return (
          <div className="flex justify-center sticky bottom-4 pt-2">
            <button
              type="submit"
              disabled={isPending || !variantsValid}
              className="btn btn-primary btn-md shadow-md"
              title={
                variantsValid
                  ? "Δημιουργία προϊόντος με τις παραλλαγές που περιγράφηκαν"
                  : "Περιγράψτε τουλάχιστον μία παραλλαγή για δημιουργία"
              }
            >
              {isPending ? "Δημιουργία…" : "Δημιουργία προϊόντος"}
            </button>
          </div>
        );
      })()}
    </form>
  );
}
