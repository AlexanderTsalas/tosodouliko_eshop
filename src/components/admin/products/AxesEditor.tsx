"use client";

import { useMemo, useState, useTransition } from "react";
import NextLink from "next/link";
import Toggle from "@/components/admin/common/Toggle";
import DeleteButton from "@/components/admin/common/DeleteButton";
import { Layers } from "@/components/admin/common/icons";
import { addMatrixCombos } from "@/actions/variants/addMatrixCombos";
import { updateVariant } from "@/actions/variants/updateVariant";
import { deleteVariant } from "@/actions/variants/deleteVariant";
import { setInventoryLevel } from "@/actions/inventory/setInventoryLevel";
import { createAttribute } from "@/actions/attributes/createAttribute";
import { createAttributeValuesBulk } from "@/actions/attributes/createAttributeValuesBulk";
import { compareAttributeValues } from "@/lib/sort-attribute-values";
import VariantComboPicker, {
  selectedCombosFromPicker,
} from "@/components/admin/products/VariantComboPicker";
import {
  buildVariantSku,
  comboKey,
  comboToPairs,
  pairsToCombo,
  type PendingPair,
} from "@/lib/variants-helpers";
import type { ProductVariant } from "@/types/product-variants";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

interface VariantInventory {
  variant_id: string;
  quantity_available: number;
  quantity_reserved: number;
  low_stock_threshold: number;
}

interface CommonAxesProps {
  initialVariants: ProductVariant[];
  initialAttributes: Attribute[];
  initialAttributeValues: AttributeValue[];
  /** Product base price — used by the combo picker for SKU/price previews. */
  basePrice: number;
  /** Product base SKU — used by the combo picker for SKU previews. */
  baseSku: string;
}

interface EditAxesProps extends CommonAxesProps {
  mode?: "edit";
  productId: string;
  /**
   * Per-variant inventory data (available, reserved, threshold).
   * Rendered as editable cells in the variants table so admins don't
   * have to navigate to each variant's detail page to set stock.
   * Variants without an inventory row fall back to zeros in the UI.
   */
  variantInventories: VariantInventory[];
}

interface CreateAxesProps extends CommonAxesProps {
  mode: "create";
  /**
   * Fires whenever the staged variants change. The parent
   * (ProductCreateClient) buffers the snapshot and includes it in the
   * atomic createProduct call. Replaces the per-action DB writes
   * that edit-mode performs via addMatrixCombos / updateVariant /
   * deleteVariant.
   */
  onVariantsChange: (variants: ProductVariant[]) => void;
}

type Props = EditAxesProps | CreateAxesProps;

/**
 * Describes the in-flight "review combinations before creating" step.
 * Set by AxisPanel's "Add values" / AddNewAxisPanel's "Add axis" /
 * gap-fill callbacks; cleared after submit or cancel.
 *
 * All three flows funnel into the same `addMatrixCombos` action — the
 * spec only differs in the rendered helper text, the confirm label,
 * and whether selection defaults to opt-in or opt-out. The candidates
 * are pre-computed by the requester.
 */
interface PickerSpec {
  kind: "add-values" | "add-axis" | "gap-fill";
  candidates: PendingPair[][];
  helperText: string;
  legendText: string;
  confirmLabel: string;
  /**
   * When true, all candidates start UNCHECKED — the admin opts IN by
   * ticking specific rows. Used by gap-fill where the default action
   * is "don't create anything until the admin chooses what to add."
   * When false (default), all candidates start checked.
   */
  optIn: boolean;
}

/**
 * Axis-first variant editor. Axes are derived from the product's variants —
 * each axis lists its values and supports "+ Add value" which fans out
 * variants across the remaining axes. "+ Add attribute type" introduces a
 * brand new axis, replicating existing variants across its values.
 *
 * Variants are displayed as a flat table below — one row per variant — so
 * the editor scales to any axis count. (Future: 2-axis grid view.)
 */
export default function AxesEditor(props: Props) {
  const {
    initialVariants,
    initialAttributes,
    initialAttributeValues,
    basePrice,
    baseSku,
  } = props;
  const isCreate = props.mode === "create";
  // Edit-mode-only props — accessing these in create mode would
  // type-error. Defaults for create mode where they don't apply.
  const productId = isCreate ? "" : (props as EditAxesProps).productId;
  const variantInventories: VariantInventory[] = isCreate
    ? []
    : (props as EditAxesProps).variantInventories;

  const [variants, setVariants] = useState(initialVariants);
  const [attributes, setAttributes] = useState(initialAttributes);
  const [attributeValues, setAttributeValues] = useState(initialAttributeValues);

  // Helper: persist staged-variant changes in create mode by pushing
  // the latest snapshot up to the parent. Wrap setVariants where the
  // change needs to propagate. No-op in edit mode (the server is the
  // source of truth there).
  function commitVariants(next: ProductVariant[]) {
    setVariants(next);
    if (isCreate) {
      (props as CreateAxesProps).onVariantsChange(next);
    }
  }

  // Inventory state — keyed by variant_id for O(1) lookup. Edits are
  // optimistic; setInventoryLevel reconciles on the server, and the
  // UI shows a brief "saved" tick per row. Empty in create mode
  // (no inventory rows exist until the product is persisted).
  const [inventoryMap, setInventoryMap] = useState(
    () =>
      new Map(
        variantInventories.map((iv) => [iv.variant_id, iv] as const)
      )
  );
  /**
   * Pending axis specs — staged via "+ Νέος άξονας" but not yet
   * committed. The admin can stage multiple before clicking
   * "Προεπισκόπηση παραλλαγών" which builds the combined Cartesian
   * preview and confirms in one batch.
   */
  const [pendingAxes, setPendingAxes] = useState<
    Array<{
      attributeId: string;
      attributeSlug: string;
      attributeName: string;
      values: Array<{ id: string; value: string }>;
    }>
  >([]);
  /** Selected variant IDs in the variants table (for bulk actions). */
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(
    new Set()
  );
  /**
   * Combo keys (as comboKey() output) the admin has unchecked in the
   * live staged preview. Resets when pendingAxes resets. Persists across
   * re-renders so admin's "no, not these" selections survive while they
   * tweak the axis list.
   */
  const [stagedSkippedKeys, setStagedSkippedKeys] = useState<Set<string>>(
    new Set()
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Combo-picker confirmation step. Null = no flow in flight; the
  // panels' "Add value" / "Add axis" callbacks set this instead of
  // firing the action directly, so the admin can review + uncheck
  // unwanted combinations before any variants are written.
  const [pickerSpec, setPickerSpec] = useState<PickerSpec | null>(null);
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());

  const valueById = useMemo(() => {
    const m = new Map<string, AttributeValue>();
    for (const v of attributeValues) m.set(v.id, v);
    return m;
  }, [attributeValues]);

  const attributeBySlug = useMemo(() => {
    const m = new Map<string, Attribute>();
    for (const a of attributes) m.set(a.slug, a);
    return m;
  }, [attributes]);

  const attributeById = useMemo(() => {
    const m = new Map<string, Attribute>();
    for (const a of attributes) m.set(a.id, a);
    return m;
  }, [attributes]);

  // Axes used by this product = union of attribute_combo keys across variants.
  // Each axis's used values = union of values across variants.
  const axes = useMemo(() => {
    const order: string[] = [];
    const valuesByAxis = new Map<string, Set<string>>();
    for (const v of variants) {
      if (!v.attribute_combo) continue;
      for (const [slug, valueId] of Object.entries(v.attribute_combo)) {
        if (!order.includes(slug)) order.push(slug);
        const set = valuesByAxis.get(slug) ?? new Set<string>();
        set.add(valueId);
        valuesByAxis.set(slug, set);
      }
    }
    return order.map((slug) => ({
      slug,
      attribute: attributeBySlug.get(slug),
      // Sort value IDs by the underlying value content — numeric
      // ascending (so "16" before "20") OR locale alphabetical
      // (Greek-aware). display_order is intentionally ignored so
      // admins don't need to manually reorder values after creation.
      valueIds: Array.from(valuesByAxis.get(slug) ?? []).sort((a, b) => {
        const va = valueById.get(a);
        const vb = valueById.get(b);
        if (!va || !vb) return 0;
        return compareAttributeValues(va, vb);
      }),
    }));
  }, [variants, attributeBySlug, valueById]);

  // Variants sorted by axes (axis-slug-alpha, then by display_order within).
  const sortedVariants = useMemo(() => {
    return [...variants].sort((a, b) => {
      const ac = a.attribute_combo ?? {};
      const bc = b.attribute_combo ?? {};
      const keys = Array.from(
        new Set([...Object.keys(ac), ...Object.keys(bc)])
      ).sort();
      for (const k of keys) {
        const av = valueById.get(ac[k]);
        const bv = valueById.get(bc[k]);
        const diff = (av?.display_order ?? 0) - (bv?.display_order ?? 0);
        if (diff !== 0) return diff;
      }
      return a.sku.localeCompare(b.sku);
    });
  }, [variants, valueById]);

  // ---------------------------------------------------------------------
  // Picker spec construction — turn an admin's "add value" / "add axis"
  // intent into a list of candidate combinations the picker can render.
  // No DB writes happen here; the action fires only after the admin
  // confirms in handleConfirmPicker.
  // ---------------------------------------------------------------------

  function handleRequestAddValues(attributeId: string, valueIds: string[]) {
    setError(null);
    if (valueIds.length === 0) {
      setError("Επιλέξτε τουλάχιστον μία τιμή.");
      return;
    }
    const attr = attributeById.get(attributeId);
    if (!attr) {
      setError("Ο τύπος χαρακτηριστικού δεν βρέθηκε.");
      return;
    }
    const newValues = valueIds
      .map((id) => attributeValues.find((v) => v.id === id))
      .filter((v): v is AttributeValue => Boolean(v));
    if (newValues.length !== valueIds.length) {
      setError("Μία ή περισσότερες τιμές δεν βρέθηκαν.");
      return;
    }

    // Candidates: for each NEW value, generate one combo per existing
    // sibling shape with that new value swapped in. If no variants
    // exist yet, each new value stands alone.
    const candidates: PendingPair[][] = [];
    const seen = new Set<string>();
    for (const av of newValues) {
      const newPair: PendingPair = {
        attributeId: attr.id,
        attributeSlug: attr.slug,
        attributeName: attr.name,
        attributeValueId: av.id,
        value: av.value,
      };
      if (variants.length === 0) {
        candidates.push([newPair]);
        continue;
      }
      for (const v of variants) {
        const combo = { ...(v.attribute_combo ?? {}) };
        combo[attr.slug] = av.id;
        const key = comboKey(combo);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(comboToPairs(combo, attributes, attributeValues));
      }
    }

    setPickerSpec({
      kind: "add-values",
      candidates,
      helperText:
        "Ξεμαρκάρετε όσους συνδυασμούς δεν θέλετε να δημιουργηθούν. Οι ήδη υπάρχοντες παραλείπονται αυτόματα.",
      legendText:
        valueIds.length === 1
          ? "Επιβεβαίωση συνδυασμών (νέα τιμή)"
          : `Επιβεβαίωση συνδυασμών (${valueIds.length} νέες τιμές)`,
      confirmLabel: "Δημιουργία επιλεγμένων",
      optIn: false,
    });
    setSkippedKeys(new Set());
  }

  /**
   * Stage an EMPTY axis for the chosen attribute. The admin then
   * fills in values via the same AxisPanel widget used for committed
   * axes — no separate "pick attribute + pick values" dialog. This
   * unifies the first-axis vs. additional-axis flow into one shape:
   * stage an empty axis card, then add values to it.
   */
  function handleStageEmptyAxis(attributeId: string) {
    setError(null);
    const attr = attributeById.get(attributeId);
    if (!attr) {
      setError("Ο τύπος χαρακτηριστικού δεν βρέθηκε.");
      return;
    }
    if (axes.some((a) => a.slug === attr.slug)) {
      setError(`Ο άξονας «${attr.name}» υπάρχει ήδη στο προϊόν.`);
      return;
    }
    if (pendingAxes.some((p) => p.attributeId === attributeId)) {
      setError(`Ο άξονας «${attr.name}» είναι ήδη σε αναμονή.`);
      return;
    }
    setPendingAxes((cur) => [
      ...cur,
      {
        attributeId: attr.id,
        attributeSlug: attr.slug,
        attributeName: attr.name,
        values: [],
      },
    ]);
  }

  /**
   * Append value ids to an already-staged axis. Mirrors the
   * "+ Προσθήκη τιμών" flow that committed axes have, but stays
   * local — nothing is committed until the admin clicks Δημιουργία
   * on the live preview.
   */
  function handleAddValuesToStagedAxis(
    attributeId: string,
    valueIds: string[]
  ) {
    setError(null);
    if (valueIds.length === 0) return;
    const newValuesData = valueIds
      .map((id) => attributeValues.find((v) => v.id === id))
      .filter((v): v is AttributeValue => Boolean(v));
    setPendingAxes((cur) =>
      cur.map((pa) => {
        if (pa.attributeId !== attributeId) return pa;
        const existingIds = new Set(pa.values.map((v) => v.id));
        const additions = newValuesData
          .filter((v) => !existingIds.has(v.id))
          .map((av) => ({ id: av.id, value: av.value }));
        return { ...pa, values: [...pa.values, ...additions] };
      })
    );
  }

  /** Remove a single value from a staged axis. */
  function handleRemoveValueFromStagedAxis(
    attributeId: string,
    valueId: string
  ) {
    setPendingAxes((cur) =>
      cur.map((pa) =>
        pa.attributeId !== attributeId
          ? pa
          : { ...pa, values: pa.values.filter((v) => v.id !== valueId) }
      )
    );
  }

  /** Remove an entire staged axis. */
  function handleRemoveStagedAxis(attributeId: string) {
    setPendingAxes((cur) => cur.filter((pa) => pa.attributeId !== attributeId));
  }

  /**
   * Live Cartesian product of the staged axes. Recomputed via useMemo
   * whenever `pendingAxes` changes — admins see the variant list grow
   * as they add axes or values without clicking a "preview" button.
   *
   * When there are existing variants, the staged axes are MULTIPLIED
   * against each existing variant (e.g. adding Size to a product that
   * already has Color produces N × M new variants). When the product
   * is brand new (no variants), the Cartesian IS the entire target
   * matrix.
   */
  const pendingCombos: PendingPair[][] = useMemo(() => {
    if (pendingAxes.length === 0) return [];
    let combos: PendingPair[][] = [[]];
    for (const ax of pendingAxes) {
      const pairs: PendingPair[] = ax.values.map((v) => ({
        attributeId: ax.attributeId,
        attributeSlug: ax.attributeSlug,
        attributeName: ax.attributeName,
        attributeValueId: v.id,
        value: v.value,
      }));
      const next: PendingPair[][] = [];
      for (const existing of combos) {
        for (const p of pairs) next.push([...existing, p]);
      }
      combos = next;
    }
    if (variants.length === 0) return combos;
    // Multiply by existing variants.
    const pendingSlugs = new Set(pendingAxes.map((a) => a.attributeSlug));
    return variants.flatMap((v) => {
      const basePairs = comboToPairs(
        v.attribute_combo ?? {},
        attributes,
        attributeValues
      );
      const safeBase = basePairs.filter(
        (p) => !pendingSlugs.has(p.attributeSlug)
      );
      return combos.map((c) => [...safeBase, ...c]);
    });
  }, [pendingAxes, variants, attributes, attributeValues]);

  /**
   * Commit the staged axes — sends the selected (non-skipped) combos
   * to addMatrixCombos. On success, clears pendingAxes and reloads to
   * pull the canonical variant list from the server.
   */
  function handleConfirmStaged() {
    setError(null);
    const selected = selectedCombosFromPicker(pendingCombos, stagedSkippedKeys);
    if (selected.length === 0) {
      setError("Δεν έχετε επιλέξει κανέναν συνδυασμό για δημιουργία.");
      return;
    }
    if (isCreate) {
      // Create mode — build virtual variants and append to local
      // state. No DB call, no reload. The parent picks up the new
      // variants via commitVariants → onVariantsChange.
      const newVariants = stageVariantsFromCombos(selected);
      const merged = [...variants, ...newVariants];
      commitVariants(merged);
      setPendingAxes([]);
      setStagedSkippedKeys(new Set());
      return;
    }
    const combos = selected.map(pairsToCombo);
    startTransition(async () => {
      const r = await addMatrixCombos({ productId, combos });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setPendingAxes([]);
      setStagedSkippedKeys(new Set());
      window.location.reload();
    });
  }

  /**
   * Build virtual ProductVariant rows from staged pair combinations
   * in create mode. Matches the shape that addMatrixCombos would
   * produce server-side (sku derived via buildVariantSku, price =
   * basePrice, attribute_combo built from pairs). Uses synthetic
   * local ids — the parent strips them before submitting to
   * createProduct, which generates real ones.
   */
  function stageVariantsFromCombos(
    combos: PendingPair[][]
  ): ProductVariant[] {
    const totalForSku = combos.length + variants.length;
    return combos.map((pairs, idx) => ({
      id: `local-variant-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
      product_id: "",
      sku: buildVariantSku(baseSku || "SKU", pairs, totalForSku),
      price: basePrice,
      attribute_combo: pairsToCombo(pairs),
      is_active: true,
      track_supply: true,
      show_when_oos: null,
      created_at: new Date().toISOString(),
    }));
  }

  // Cartesian of every (axis, value) combination across the product's
  // CURRENT axis values. Used by the gap-fill flow to surface combos
  // that don't currently exist as variants — i.e., holes the admin
  // skipped at create time or holes that emerged from variant
  // deletion. Returns the canonical comboKey set of existing variants
  // alongside the missing combos, so the picker can render the
  // existing ones disabled (informational) and the missing ones as
  // selectable.
  const matrixGaps = useMemo(() => {
    if (axes.length === 0) {
      return { missing: [] as PendingPair[][], existingKeys: new Set<string>() };
    }
    const existingKeys = new Set<string>();
    for (const v of variants) {
      if (v.attribute_combo) existingKeys.add(comboKey(v.attribute_combo));
    }
    // Cartesian product across axes.
    let acc: PendingPair[][] = [[]];
    for (const axis of axes) {
      const attr = axis.attribute;
      if (!attr) continue;
      const next: PendingPair[][] = [];
      for (const partial of acc) {
        for (const valId of axis.valueIds) {
          const av = valueById.get(valId);
          if (!av) continue;
          next.push([
            ...partial,
            {
              attributeId: attr.id,
              attributeSlug: attr.slug,
              attributeName: attr.name,
              attributeValueId: av.id,
              value: av.value,
            },
          ]);
        }
      }
      acc = next;
    }
    const missing = acc.filter((combo) => !existingKeys.has(comboKey(combo)));
    return { missing, existingKeys };
  }, [axes, variants, valueById]);

  function handleRequestGapFill() {
    setError(null);
    if (matrixGaps.missing.length === 0) {
      setError("Όλοι οι δυνατοί συνδυασμοί έχουν ήδη δημιουργηθεί.");
      return;
    }
    setPickerSpec({
      kind: "gap-fill",
      candidates: matrixGaps.missing,
      helperText:
        "Μαρκάρετε τους συνδυασμούς που λείπουν από τη matrix και θέλετε να δημιουργηθούν.",
      legendText: `Συμπλήρωση κενών (${matrixGaps.missing.length} διαθέσιμοι)`,
      confirmLabel: "Δημιουργία επιλεγμένων",
      optIn: true,
    });
    // Opt-in: pre-populate skippedKeys with every candidate so all start
    // unchecked. The admin ticks the ones they want.
    const initialSkipped = new Set<string>();
    for (const c of matrixGaps.missing) initialSkipped.add(comboKey(c));
    setSkippedKeys(initialSkipped);
  }

  function handleConfirmPicker() {
    if (!pickerSpec) return;
    const selected = selectedCombosFromPicker(
      pickerSpec.candidates,
      skippedKeys
    );
    if (selected.length === 0) {
      setError("Δεν έχετε επιλέξει κανένα συνδυασμό για δημιουργία.");
      return;
    }
    if (isCreate) {
      // Create mode — same path as handleConfirmStaged but for the
      // picker-driven flows (add-values / add-axis / gap-fill).
      const newVariants = stageVariantsFromCombos(selected);
      const merged = [...variants, ...newVariants];
      commitVariants(merged);
      setPickerSpec(null);
      setSkippedKeys(new Set());
      setPendingAxes([]);
      return;
    }
    const combos = selected.map(pairsToCombo);

    setError(null);
    startTransition(async () => {
      const r = await addMatrixCombos({ productId, combos });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setPickerSpec(null);
      setSkippedKeys(new Set());
      // Clear staged axes — they've been committed.
      setPendingAxes([]);
      window.location.reload();
    });
  }

  function handleCancelPicker() {
    // Cancel just closes the picker — pendingAxes stay so the admin
    // can edit them and re-preview. Use the "Καθαρισμός" button on
    // the pending list to discard all staged axes.
    setPickerSpec(null);
    setSkippedKeys(new Set());
    setError(null);
  }

  function handleToggleActive(variant: ProductVariant) {
    const prev = variants;
    const next = variants.map((v) =>
      v.id === variant.id ? { ...v, is_active: !v.is_active } : v
    );
    if (isCreate) {
      // Local-only toggle; commitVariants pushes to parent.
      commitVariants(next);
      return;
    }
    setVariants(next);
    startTransition(async () => {
      const r = await updateVariant({ id: variant.id, isActive: !variant.is_active });
      if (!r.success) {
        setError(r.error);
        setVariants(prev);
      }
    });
  }

  /**
   * Inline inventory edit handler.
   *
   * Editable fields:
   *   - "quantity_available"  — current stock count
   *   - "low_stock_threshold" — re-stock alert threshold
   *
   * NOT editable (deliberately removed):
   *   - quantity_reserved — managed by the order lifecycle.
   *     Letting admins overwrite it broke deleteOrder via
   *     INSUFFICIENT_RESERVED when reserved was set below an active
   *     reservation. It now renders as a read-only count.
   *
   * Optimistic update: the local inventoryMap is updated immediately;
   * setInventoryLevel reconciles in the background. On failure the
   * cell reverts and an error message is shown.
   */
  function handleInventoryChange(
    variantId: string,
    field: "quantity_available" | "low_stock_threshold",
    next: number
  ) {
    // Inventory editing is N/A in create mode — there's no inventory
    // row until the variants are persisted. The inventory cells are
    // also hidden in create mode (see the variants-table render
    // below), so this guard is belt-and-braces.
    if (isCreate) return;
    if (!Number.isFinite(next) || next < 0) return;
    const cur = inventoryMap.get(variantId) ?? {
      variant_id: variantId,
      quantity_available: 0,
      quantity_reserved: 0,
      low_stock_threshold: 0,
    };
    if (cur[field] === next) return; // no-op
    const updated = { ...cur, [field]: next };
    const prev = cur;
    setInventoryMap((m) => new Map(m).set(variantId, updated));
    setError(null);
    startTransition(async () => {
      const r = await setInventoryLevel({
        variantId,
        quantityAvailable:
          field === "quantity_available" ? next : updated.quantity_available,
        // quantity_reserved is intentionally NOT passed — leaves the
        // DB-side COALESCE to keep whatever the order system has
        // recorded. Bypassing this lock would require a separate
        // "reconcile" action with its own audit trail.
        lowStockThreshold:
          field === "low_stock_threshold" ? next : updated.low_stock_threshold,
      });
      if (!r.success) {
        setError(r.error);
        setInventoryMap((m) => new Map(m).set(variantId, prev));
      }
    });
  }

  /**
   * Bulk operations on the selected variants. We loop the existing
   * single-row actions in Promise.all rather than introducing a new
   * server action — N parallel server calls is fine at the
   * realistic scale here (rarely > 50 selected at once), and reusing
   * existing actions keeps audit logs and RLS checks identical for
   * single + bulk paths.
   */
  function handleBulkSetActive(active: boolean) {
    const ids = Array.from(selectedVariantIds);
    if (ids.length === 0) return;
    setError(null);
    const nextVariants = variants.map((v) =>
      selectedVariantIds.has(v.id) ? { ...v, is_active: active } : v
    );
    if (isCreate) {
      // Local-only bulk toggle.
      commitVariants(nextVariants);
      setSelectedVariantIds(new Set());
      return;
    }
    // Optimistic update.
    const prev = variants;
    setVariants(nextVariants);
    startTransition(async () => {
      const results = await Promise.all(
        ids.map((id) => updateVariant({ id, isActive: active }))
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(
          `${failed.length} από ${ids.length} αλλαγές απέτυχαν. Δοκιμάστε ξανά.`
        );
        setVariants(prev);
      } else {
        setSelectedVariantIds(new Set());
      }
    });
  }

  function handleBulkDelete() {
    const ids = Array.from(selectedVariantIds);
    if (ids.length === 0) return;
    // Confirm prompt only in edit mode (data has been persisted). In
    // create mode the variants are staged in memory, so misclicks
    // are cheap to recover from by re-adding the axis values.
    if (
      !isCreate &&
      !confirm(
        `Διαγραφή ${ids.length} ${
          ids.length === 1 ? "παραλλαγής" : "παραλλαγών"
        }; Η ενέργεια δεν αναιρείται.`
      )
    ) {
      return;
    }
    setError(null);
    const nextVariants = variants.filter(
      (v) => !selectedVariantIds.has(v.id)
    );
    if (isCreate) {
      commitVariants(nextVariants);
      setSelectedVariantIds(new Set());
      return;
    }
    const prev = variants;
    setVariants(nextVariants);
    startTransition(async () => {
      const results = await Promise.all(
        ids.map((id) => deleteVariant({ id }))
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(
          `${failed.length} από ${ids.length} διαγραφές απέτυχαν. Δοκιμάστε ξανά.`
        );
        setVariants(prev);
      } else {
        setSelectedVariantIds(new Set());
      }
    });
  }

  function toggleVariantSelection(id: string) {
    setSelectedVariantIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(allVariantIds: string[]) {
    setSelectedVariantIds((cur) => {
      const allSelected = allVariantIds.every((id) => cur.has(id));
      if (allSelected) return new Set();
      return new Set(allVariantIds);
    });
  }

  function handleDeleteVariant(variantId: string) {
    // Confirm only in edit mode — create mode is in-memory, cheap to
    // undo by re-adding.
    if (!isCreate && !confirm("Διαγραφή παραλλαγής;")) return;
    const next = variants.filter((v) => v.id !== variantId);
    if (isCreate) {
      commitVariants(next);
      return;
    }
    const prev = variants;
    setVariants(next);
    startTransition(async () => {
      const r = await deleteVariant({ id: variantId });
      if (!r.success) {
        setError(r.error);
        setVariants(prev);
      }
    });
  }

  function handleBulkSetPrice(price: number) {
    setError(null);
    if (!Number.isFinite(price) || price < 0) {
      setError("Μη έγκυρη τιμή.");
      return;
    }
    // Confirm only in edit mode — many DB writes about to fire.
    // Create mode just updates local state, no harm in immediate
    // application.
    if (
      !isCreate &&
      !confirm(`Ορισμός τιμής ${price.toFixed(2)} σε ${variants.length} παραλλαγές;`)
    ) {
      return;
    }
    const nextVariants = variants.map((v) => ({ ...v, price }));
    if (isCreate) {
      commitVariants(nextVariants);
      return;
    }
    const prev = variants;
    setVariants(nextVariants);
    startTransition(async () => {
      for (const v of prev) {
        const r = await updateVariant({ id: v.id, price });
        if (!r.success) {
          setError(`Σφάλμα στην παραλλαγή ${v.sku}: ${r.error}`);
          setVariants(prev);
          return;
        }
      }
    });
  }

  /**
   * Bulk apply a price to ONLY the selected variants. Mirrors
   * handleBulkSetPrice but scoped to the selection set so admins can
   * configure stock/threshold/price on a slice of variants without
   * jumping into per-variant detail pages.
   */
  function handleBulkSelectedPrice(price: number) {
    const ids = Array.from(selectedVariantIds);
    if (ids.length === 0) return;
    setError(null);
    if (!Number.isFinite(price) || price < 0) {
      setError("Μη έγκυρη τιμή.");
      return;
    }
    const idSet = new Set(ids);
    const nextVariants = variants.map((v) =>
      idSet.has(v.id) ? { ...v, price } : v
    );
    if (isCreate) {
      commitVariants(nextVariants);
      setSelectedVariantIds(new Set());
      return;
    }
    const prev = variants;
    setVariants(nextVariants);
    startTransition(async () => {
      const results = await Promise.all(
        ids.map((id) => updateVariant({ id, price }))
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(
          `${failed.length} από ${ids.length} αλλαγές τιμής απέτυχαν. Δοκιμάστε ξανά.`
        );
        setVariants(prev);
      } else {
        setSelectedVariantIds(new Set());
      }
    });
  }

  /**
   * Bulk apply a stock quantity (quantity_available) to ONLY the
   * selected variants. In create mode the inventory_items row doesn't
   * exist yet, so this is a no-op (the admin can configure stock
   * after saving). In edit mode each variant's inventory row is
   * updated via setInventoryLevel; the lowStockThreshold field is
   * intentionally omitted so we keep whatever the variant already has.
   */
  function handleBulkSelectedStock(qty: number) {
    if (isCreate) return;
    const ids = Array.from(selectedVariantIds);
    if (ids.length === 0) return;
    setError(null);
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      setError("Μη έγκυρο απόθεμα.");
      return;
    }
    // Optimistic local update — admin sees the new available count
    // immediately in the table cells.
    const prevMap = new Map(inventoryMap);
    setInventoryMap((cur) => {
      const next = new Map(cur);
      for (const id of ids) {
        const existing = next.get(id) ?? {
          variant_id: id,
          quantity_available: 0,
          quantity_reserved: 0,
          low_stock_threshold: 0,
        };
        next.set(id, { ...existing, quantity_available: qty });
      }
      return next;
    });

    startTransition(async () => {
      const results = await Promise.all(
        ids.map((id) =>
          setInventoryLevel({ variantId: id, quantityAvailable: qty })
        )
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(
          `${failed.length} από ${ids.length} αλλαγές αποθέματος απέτυχαν. Δοκιμάστε ξανά.`
        );
        setInventoryMap(prevMap);
      } else {
        setSelectedVariantIds(new Set());
      }
    });
  }

  /**
   * Bulk apply a low-stock threshold to ONLY the selected variants.
   * Pairs with handleBulkSelectedStock — same mechanics, different
   * field. setInventoryLevel requires quantityAvailable so we pass
   * the current value (from inventoryMap) for each variant to keep
   * the available unchanged when only threshold is being updated.
   */
  function handleBulkSelectedThreshold(threshold: number) {
    if (isCreate) return;
    const ids = Array.from(selectedVariantIds);
    if (ids.length === 0) return;
    setError(null);
    if (
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      !Number.isInteger(threshold)
    ) {
      setError("Μη έγκυρο όριο.");
      return;
    }
    const prevMap = new Map(inventoryMap);
    setInventoryMap((cur) => {
      const next = new Map(cur);
      for (const id of ids) {
        const existing = next.get(id) ?? {
          variant_id: id,
          quantity_available: 0,
          quantity_reserved: 0,
          low_stock_threshold: 0,
        };
        next.set(id, { ...existing, low_stock_threshold: threshold });
      }
      return next;
    });

    startTransition(async () => {
      const results = await Promise.all(
        ids.map((id) => {
          const cur = prevMap.get(id);
          return setInventoryLevel({
            variantId: id,
            quantityAvailable: cur?.quantity_available ?? 0,
            lowStockThreshold: threshold,
          });
        })
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(
          `${failed.length} από ${ids.length} αλλαγές ορίου απέτυχαν. Δοκιμάστε ξανά.`
        );
        setInventoryMap(prevMap);
      } else {
        setSelectedVariantIds(new Set());
      }
    });
  }

  return (
    <section className="cms-card-section space-y-5">
      <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
        <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Άξονες παραλλαγών
        </h2>
        <p className="text-sm text-foreground/70 mt-1.5 max-w-3xl">
          Οι <strong>άξονες</strong> είναι τα χαρακτηριστικά που διαφοροποιούν τις
          παραλλαγές του προϊόντος μεταξύ τους — π.χ. <em>Χρώμα</em>, <em>Μέγεθος</em>,
          <em>Άρωμα</em>. Κάθε συνδυασμός τιμών (π.χ. «μπεζ + 23») δημιουργεί μία
          ξεχωριστή παραλλαγή με δικό της SKU, τιμή και απόθεμα. Σε αντίθεση με τις
          προδιαγραφές, οι άξονες <strong>είναι επιλέξιμοι από τον πελάτη</strong>
          στη σελίδα προϊόντος.
        </p>
      </header>

      {/* Axes list — flex-wrap so each axis container sizes to its
          OWN content. A short axis (2 values) takes a narrow box,
          a long one (10 values) takes a wider box, and they all flow
          left-to-right wrapping naturally. The "+ Νέος άξονας" tile
          sits at the end of the flow as another wrap candidate, so
          it reads as the next slot rather than as a footer action. */}
      {/* Axes container — same shape regardless of whether the
          product has committed axes, staged axes, neither, or both.
          One flex-wrap renders all three: committed AxisPanels,
          staged AxisPanels (identical widget, dashed border), and
          the "+ Νέος άξονας" tile at the end. This is the unified
          "axon container" — same behavior for first vs additional
          axes. */}
      <div className="flex flex-wrap items-stretch gap-3">
        {axes.map((axis) => (
          <AxisPanel
            key={axis.slug}
            axis={axis}
            attributeValues={attributeValues}
            valueById={valueById}
            isPending={isPending || pickerSpec !== null}
            onAddValues={handleRequestAddValues}
            onCreateValue={(av) => {
              setAttributeValues((cur) => [...cur, av]);
            }}
          />
        ))}
        {/* Staged axes use the SAME AxisPanel widget with staged=true.
            Same chips + same "+ Προσθήκη τιμών" affordance + same
            value creator. Only difference: dashed border, "σε αναμονή"
            badge, and onAddValues stages locally instead of going
            through the combo picker. */}
        {pendingAxes.map((pa) => {
          const stagedAxis: AxisShape = {
            slug: pa.attributeSlug,
            valueIds: pa.values.map((v) => v.id),
            attribute: {
              id: pa.attributeId,
              slug: pa.attributeSlug,
              name: pa.attributeName,
            } as Attribute,
          };
          return (
            <AxisPanel
              key={`staged-${pa.attributeId}`}
              axis={stagedAxis}
              attributeValues={attributeValues}
              valueById={valueById}
              isPending={isPending}
              staged
              onAddValues={handleAddValuesToStagedAxis}
              onCreateValue={(av) =>
                setAttributeValues((cur) => [...cur, av])
              }
              onRemoveValue={handleRemoveValueFromStagedAxis}
              onRemoveAxis={handleRemoveStagedAxis}
            />
          );
        })}
        <AddNewAxisPanel
          attributes={attributes}
          excludeAttributeSlugs={
            new Set([
              ...axes.map((a) => a.slug),
              ...pendingAxes.map((p) => p.attributeSlug),
            ])
          }
          isPending={isPending}
          onPickAttribute={handleStageEmptyAxis}
          onCreateAttribute={(a) => setAttributes((cur) => [...cur, a])}
        />
      </div>

      {/* LIVE preview of staged axes — renders the Cartesian product
          inline as the admin adds axes and values. No "Preview" button
          gate; the list below updates in real time so the admin sees
          exactly what variants will be created on every keystroke. */}
      {pendingAxes.length > 0 && (
        <div className="rounded-md border-2 border-foreground/30 bg-background -mx-5 sm:-mx-6 px-5 sm:px-6 py-4 -mb-5 sm:-mb-6 mt-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Προεπισκόπηση παραλλαγών προς δημιουργία
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                <strong>{pendingCombos.length}</strong>{" "}
                {pendingCombos.length === 1 ? "συνδυασμός" : "συνδυασμοί"} —
                {variants.length === 0
                  ? " αυτοί θα γίνουν οι παραλλαγές του προϊόντος."
                  : " θα προστεθούν στις υπάρχουσες παραλλαγές."}{" "}
                Ξεμαρκάρετε όσους δεν θέλετε να δημιουργηθούν.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPendingAxes([])}
                disabled={isPending}
                className="btn btn-secondary btn-sm"
              >
                Καθαρισμός
              </button>
              <button
                type="button"
                onClick={handleConfirmStaged}
                disabled={isPending || pendingCombos.length === 0}
                className="btn btn-primary btn-md"
              >
                {isPending
                  ? "Δημιουργία..."
                  : `Δημιουργία (${
                      pendingCombos.length - stagedSkippedKeys.size
                    })`}
              </button>
            </div>
          </div>
          {pendingCombos.length > 0 && (
            <VariantComboPicker
              combinations={pendingCombos}
              basePrice={basePrice}
              baseSku={baseSku}
              attributes={attributes}
              attributeValues={attributeValues}
              skippedComboKeys={stagedSkippedKeys}
              onSkippedChange={setStagedSkippedKeys}
              helperText="Ο κατάλογος ενημερώνεται αυτόματα κάθε φορά που προσθέτετε νέο άξονα ή τιμές."
              alwaysShowCheckbox={false}
            />
          )}
        </div>
      )}

      {/* Gap-fill bar — surfaced separately when there are missing
          combinations between existing axes. */}
      {axes.length > 0 && matrixGaps.missing.length > 0 && !pickerSpec && (
        <div className="flex justify-end pt-3 border-t border-foreground/10">
          <button
            type="button"
            onClick={handleRequestGapFill}
            disabled={isPending}
            className="btn btn-secondary btn-sm"
          >
            <span className="text-base leading-none">⊕</span>
            Συμπλήρωση κενών
            <span className="text-xs text-muted-foreground ml-1">
              ({matrixGaps.missing.length})
            </span>
          </button>
        </div>
      )}

      {/* Combo picker confirmation step — used by all three flows
          (add-values, add-axis, gap-fill). The flow-specific copy comes
          from the spec; the picker itself doesn't know which flow it
          serves. */}
      {pickerSpec && (
        <fieldset className="border-2 border-foreground/40 rounded-md p-4 space-y-3 bg-background">
          <legend className="text-sm font-semibold px-2">
            {pickerSpec.legendText}
          </legend>
          {/* Explanation banner — admins are about to commit a SET of
              variant combinations to the database. They need to know
              this list is auto-generated as the Cartesian product of
              the axes they've defined, and that they can opt out
              individual rows BEFORE confirming. Without this the
              picker reads like "review and approve" rather than
              "tweak before approve". */}
          <div className="rounded-md border border-foreground/15 bg-muted/40 px-3 py-2.5 text-xs text-foreground/80">
            <p className="font-medium text-foreground mb-1">
              Προεπισκόπηση παραλλαγών προς δημιουργία
            </p>
            <p>
              Ο πίνακας παρακάτω εμφανίζει{" "}
              <strong>όλους τους πιθανούς συνδυασμούς</strong> τιμών για τους
              άξονες που έχετε ορίσει — δημιουργείται αυτόματα από το γινόμενό
              τους. Ελέγξτε τους συνδυασμούς και{" "}
              <strong>αφαιρέστε όσους δεν θέλετε να δημιουργηθούν</strong>{" "}
              (π.χ. αδύνατοι συνδυασμοί χρωμάτων–μεγεθών). Μόνο οι τσεκαρισμένες
              γραμμές θα γίνουν πραγματικές παραλλαγές.
            </p>
          </div>
          <VariantComboPicker
            combinations={pickerSpec.candidates}
            basePrice={basePrice}
            baseSku={baseSku}
            attributes={attributes}
            attributeValues={attributeValues}
            skippedComboKeys={skippedKeys}
            onSkippedChange={setSkippedKeys}
            helperText={pickerSpec.helperText}
            alwaysShowCheckbox={pickerSpec.optIn}
          />
          <div className="flex items-center gap-2 pt-3 border-t border-foreground/10">
            <button
              type="button"
              onClick={handleConfirmPicker}
              disabled={isPending}
              className="btn btn-primary btn-md"
            >
              {isPending ? "Δημιουργία..." : pickerSpec.confirmLabel}
            </button>
            <button
              type="button"
              onClick={handleCancelPicker}
              disabled={isPending}
              className="btn btn-secondary btn-sm"
            >
              Άκυρο
            </button>
          </div>
        </fieldset>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Variants table */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-lg font-semibold">Παραλλαγές ({variants.length})</h3>
          <BulkPriceControl
            disabled={isPending || variants.length === 0}
            onApply={handleBulkSetPrice}
          />
        </div>

        {/* Bulk action bar — only visible when at least one variant is
            selected. Provides activate/deactivate/delete on the
            selected set + inline numeric setters for price, stock,
            and threshold so admins don't have to jump into the
            per-variant detail page for routine batch edits. Reuses
            the existing single-row server actions on the inside for
            audit-log/RLS consistency. */}
        {selectedVariantIds.size > 0 && (
          <div className="cms-bulk-bar">
            <p className="cms-bulk-bar-label">
              <strong>{selectedVariantIds.size}</strong>{" "}
              {selectedVariantIds.size === 1 ? "επιλεγμένη" : "επιλεγμένες"} παραλλαγ
              {selectedVariantIds.size === 1 ? "ή" : "ές"}
            </p>
            <button
              type="button"
              onClick={() => handleBulkSetActive(true)}
              disabled={isPending}
              className="btn btn-secondary btn-sm"
            >
              Ενεργοποίηση
            </button>
            <button
              type="button"
              onClick={() => handleBulkSetActive(false)}
              disabled={isPending}
              className="btn btn-secondary btn-sm"
            >
              Απενεργοποίηση
            </button>
            <DeleteButton
              onClick={handleBulkDelete}
              label="Διαγραφή"
              disabled={isPending}
            />
            {/* Inline numeric setters — price always available, stock
                and threshold only in edit mode (inventory rows don't
                exist yet in create mode). All controls flow in the
                same flex-wrap row as the action buttons so the bar
                stays on one line whenever it fits. */}
            <BulkNumericControl
              label="Τιμή"
              placeholder="0.00"
              step="0.01"
              min={0}
              allowDecimal
              disabled={isPending}
              onApply={handleBulkSelectedPrice}
            />
            {!isCreate && (
              <>
                <BulkNumericControl
                  label="Απόθεμα"
                  placeholder="0"
                  step="1"
                  min={0}
                  disabled={isPending}
                  onApply={handleBulkSelectedStock}
                />
                <BulkNumericControl
                  label="Όριο χαμηλού"
                  placeholder="0"
                  step="1"
                  min={0}
                  disabled={isPending}
                  onApply={handleBulkSelectedThreshold}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => setSelectedVariantIds(new Set())}
              disabled={isPending}
              className="cms-bulk-bar-clear"
            >
              Καθαρισμός
            </button>
          </div>
        )}

        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground border rounded-md p-4 text-center">
            Δεν υπάρχουν παραλλαγές. Προσθέστε έναν άξονα και μία τιμή για να ξεκινήσετε.
          </p>
        ) : (
          /* Table wrapper — sits inside cms-card-section (grey bg), so
             we use bg-background (white) + shadow to make the table
             pop forward as a discrete data surface. */
          <div className="rounded-lg overflow-hidden bg-background shadow-[0_1px_2px_rgba(0,0,0,0.05),0_2px_10px_rgba(0,0,0,0.06)] border border-foreground/10">
            <table className="w-full text-sm">
              <thead>
                {/* Header row sits 1 shade DARKER than the data rows so
                    it visually anchors the top of the table. */}
                <tr className="bg-muted/80 text-xs uppercase tracking-wide text-foreground border-b border-foreground/15">
                  {/* Select-all checkbox. Reflects "all visible rows
                      selected" — clicking toggles between all/none. */}
                  <th className="text-center px-2 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={
                        sortedVariants.length > 0 &&
                        sortedVariants.every((v) =>
                          selectedVariantIds.has(v.id)
                        )
                      }
                      onChange={() =>
                        toggleSelectAll(sortedVariants.map((v) => v.id))
                      }
                      aria-label="Επιλογή όλων"
                    />
                  </th>
                  <th className="text-left px-3 py-2.5 font-semibold">SKU</th>
                  {axes.map((a) => (
                    <th key={a.slug} className="text-left px-3 py-2.5 font-semibold">
                      {a.attribute?.name ?? a.slug}
                    </th>
                  ))}
                  <th className="text-center px-3 py-2.5 font-semibold">Τιμή</th>
                  {/* Inventory columns hidden in create mode — there's
                      no inventory row yet (variants haven't been
                      persisted). Inventory becomes editable on the
                      edit page after creation. */}
                  {!isCreate && (
                    <>
                      <th
                        className="text-center px-3 py-2.5 font-semibold w-20"
                        title="Διαθέσιμα τεμάχια — εδώ αλλάζεις το πραγματικό απόθεμα"
                      >
                        Διαθέσιμα
                      </th>
                      <th
                        className="text-center px-3 py-2.5 font-semibold w-20"
                        title="Όριο χαμηλού αποθέματος — 0 = δεν ενεργοποιείται"
                      >
                        Όριο
                      </th>
                      <th
                        className="text-center px-3 py-2.5 font-semibold w-20"
                        title="Τεμάχια δεσμευμένα από ενεργές παραγγελίες (read-only — διαχειρίζεται αυτόματα)"
                      >
                        Held
                      </th>
                    </>
                  )}
                  <th className="text-left px-3 py-2.5 font-semibold">Κατάσταση</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Ενέργειες</th>
                </tr>
              </thead>
              <tbody>
                {sortedVariants.map((v, idx) => (
                  <tr
                    key={v.id}
                    className={`${
                      idx !== sortedVariants.length - 1
                        ? "border-b border-foreground/10"
                        : ""
                    } hover:bg-muted/30 transition-colors ${
                      !v.is_active ? "opacity-60" : ""
                    } ${selectedVariantIds.has(v.id) ? "bg-muted/40" : ""}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedVariantIds.has(v.id)}
                        onChange={() => toggleVariantSelection(v.id)}
                        aria-label={`Επιλογή ${v.sku}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{v.sku}</td>
                    {axes.map((a) => {
                      const valId = v.attribute_combo?.[a.slug];
                      const av = valId ? valueById.get(valId) : null;
                      return (
                        <td key={a.slug} className="px-3 py-2 text-xs">
                          {av?.value ?? "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 font-mono text-center tabular-nums">
                      {Number(v.price).toFixed(2)}
                    </td>
                    {/* Inline inventory editors.
                        - Διαθέσιμα + Όριο are EDITABLE (admin's stock
                          counts + restock alert threshold).
                        - Held (quantity_reserved) is READ-ONLY. It's
                          managed by the order lifecycle (placeOrder
                          increments, deleteOrder/cancel decrements).
                          Letting an admin overwrite it directly used
                          to break order deletion via
                          INSUFFICIENT_RESERVED — once the count was
                          set below an active reservation, the order
                          could no longer free its own stock. */}
                    {/* Inventory cells (available / threshold / held)
                        are hidden in create mode — the variant doesn't
                        have an inventory row yet. Inventory becomes
                        editable in the variants table once the
                        product is created. */}
                    {!isCreate &&
                      (() => {
                        const inv = inventoryMap.get(v.id);
                        const renderEditable = (
                          field: "quantity_available" | "low_stock_threshold"
                        ) => (
                          <td className="px-1 py-2 text-center">
                            <input
                              type="number"
                              min={0}
                              defaultValue={inv?.[field] ?? 0}
                              key={`${v.id}-${field}-${inv?.[field] ?? 0}`}
                              onBlur={(e) =>
                                handleInventoryChange(
                                  v.id,
                                  field,
                                  Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-16 text-center font-mono tabular-nums bg-transparent border border-foreground/10 rounded px-1.5 py-1 focus:outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/15 hover:border-foreground/30 transition-colors text-xs"
                              aria-label={`${field} για ${v.sku}`}
                            />
                          </td>
                        );
                        const reserved = inv?.quantity_reserved ?? 0;
                        return (
                          <>
                            {renderEditable("quantity_available")}
                            {renderEditable("low_stock_threshold")}
                            <td
                              className="px-1 py-2 text-center"
                              title="Διαχειρίζεται αυτόματα από τις παραγγελίες — δεν επεξεργάζεται απευθείας."
                            >
                              <span className="inline-block w-16 text-center font-mono tabular-nums text-xs text-muted-foreground py-1 px-1.5">
                                {reserved}
                              </span>
                            </td>
                          </>
                        );
                      })()}
                    <td className="px-3 py-2">
                      <Toggle
                        checked={v.is_active}
                        onChange={() => handleToggleActive(v)}
                        size="sm"
                        label={v.is_active ? "Ενεργή" : "Ανενεργή"}
                        ariaLabel={
                          v.is_active
                            ? `Απενεργοποίηση ${v.sku}`
                            : `Ενεργοποίηση ${v.sku}`
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {/* Variant detail link only useful in edit
                            mode — in create mode the variant doesn't
                            exist yet (synthetic local id) so the URL
                            would 404. The detail page becomes
                            available on the post-create edit page. */}
                        {!isCreate && (
                          <NextLink
                            href={`/admin/products?focus=${productId}`}
                            className="btn btn-secondary btn-sm"
                          >
                            Λεπτομέρειες
                          </NextLink>
                        )}
                        <DeleteButton
                          onClick={() => handleDeleteVariant(v.id)}
                          ariaLabel="Διαγραφή παραλλαγής"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AxisShape {
  slug: string;
  attribute: Attribute | undefined;
  valueIds: string[];
}

function AxisPanel({
  axis,
  attributeValues,
  valueById,
  isPending,
  staged = false,
  onAddValues,
  onCreateValue,
  onRemoveValue,
  onRemoveAxis,
}: {
  axis: AxisShape;
  attributeValues: AttributeValue[];
  valueById: Map<string, AttributeValue>;
  isPending: boolean;
  /**
   * When true, this panel represents a STAGED axis (not yet committed).
   * Visual: dashed border + "σε αναμονή" badge. Value chips get a
   * remove (×) affordance, and the panel grows a delete button to
   * discard the entire staged axis. onAddValues becomes a pure local
   * stage operation rather than going through the combo picker.
   */
  staged?: boolean;
  onAddValues: (attributeId: string, valueIds: string[]) => void;
  onCreateValue: (av: AttributeValue) => void;
  /** Only used when staged=true — remove a single value from staging. */
  onRemoveValue?: (attributeId: string, valueId: string) => void;
  /** Only used when staged=true — discard the entire staged axis. */
  onRemoveAxis?: (attributeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedValueIds, setSelectedValueIds] = useState<string[]>([]);
  const [newValueText, setNewValueText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const attr = axis.attribute;
  if (!attr) return null;

  // Values under this attribute that aren't already on this product's axis.
  const usedSet = new Set(axis.valueIds);
  const availableValues = attributeValues.filter(
    (v) => v.attribute_id === attr.id && !usedSet.has(v.id)
  );

  function handleSubmit() {
    setError(null);
    if (selectedValueIds.length === 0) {
      setError("Επιλέξτε τουλάχιστον μία τιμή.");
      return;
    }
    onAddValues(attr!.id, selectedValueIds);
    // Don't close — the picker confirmation step opens above. Reset
    // local selection so a follow-up "Add values" pass starts clean.
    setOpen(false);
    setSelectedValueIds([]);
  }

  function handleCreate() {
    setError(null);
    const raw = newValueText.trim();
    if (!raw) return;
    // Batch-create: split on commas/newlines, send everything in one
    // server round-trip. Each created value is then optimistically
    // ticked into the selected set so the admin can immediately commit
    // them as a new combo set. Existing slugs come back in `skipped`
    // — we still tick those because the admin intends to add them.
    startTransition(async () => {
      const r = await createAttributeValuesBulk({
        attributeId: attr!.id,
        raw,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      // Append fresh values to local state + auto-tick them.
      for (const av of r.data.created) {
        onCreateValue(av);
      }
      const createdIds = r.data.created.map((av) => av.id);
      // Also tick already-existing values that match the typed text —
      // admins pasting a known list expect every listed value to be
      // selected, not just the brand-new ones.
      const skippedSlugSet = new Set(r.data.skipped.map((v) => v.toLowerCase()));
      const existingIdsToTick = attributeValues
        .filter((av) => av.attribute_id === attr!.id)
        .filter((av) => skippedSlugSet.has(av.value.toLowerCase()))
        .map((av) => av.id);
      setSelectedValueIds((cur) =>
        Array.from(new Set([...cur, ...createdIds, ...existingIdsToTick]))
      );
      setNewValueText("");
    });
  }

  return (
    <fieldset
      className={`rounded-md ${
        staged
          ? "border-2 border-dashed border-foreground/40"
          : "border border-foreground/15"
      } bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.05)] max-w-full`}
    >
      <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 px-1 flex items-center gap-2">
        <span>{attr.name}</span>
        {staged && (
          <>
            <span className="cms-badge cms-badge-muted text-[10px]">
              σε αναμονή
            </span>
            <button
              type="button"
              onClick={() => onRemoveAxis?.(attr.id)}
              disabled={isPending}
              className="ml-1 text-muted-foreground hover:text-destructive transition-colors text-xs leading-none disabled:opacity-50"
              title={`Αφαίρεση «${attr.name}» από τα προς δημιουργία`}
              aria-label="Αφαίρεση άξονα"
            >
              ×
            </button>
          </>
        )}
      </legend>
      {/* Value chips + "Add values" button INLINE — same shape for
          committed and staged axes. Staged chips get an extra ×
          affordance so the admin can remove individual values before
          commit. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {axis.valueIds.map((vid) => {
          const av = valueById.get(vid);
          return (
            <span
              key={vid}
              className="rounded-md border border-foreground/15 bg-muted/50 px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1"
            >
              {av?.value ?? "(unknown)"}
              {staged && (
                <button
                  type="button"
                  onClick={() => onRemoveValue?.(attr.id, vid)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors text-sm leading-none disabled:opacity-50"
                  aria-label={`Αφαίρεση τιμής ${av?.value ?? vid}`}
                  title="Αφαίρεση τιμής"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {axis.valueIds.length === 0 && (
          <span className="text-[11px] text-muted-foreground italic">
            Καμία τιμή ακόμη — προσθέστε παρακάτω.
          </span>
        )}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={isPending}
            className="rounded-md border border-dashed border-foreground/40 hover:border-foreground hover:bg-muted/50 px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent inline-flex items-center gap-1"
          >
            <span className="text-sm leading-none">+</span>
            Προσθήκη τιμών
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 bg-muted/40 rounded p-3">
          {availableValues.length > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Επιλέξτε τιμές προς προσθήκη:
              </p>
              <div className="flex flex-wrap gap-2">
                {availableValues.map((v) => {
                  const isOn = selectedValueIds.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`text-xs px-2 py-1 rounded border cursor-pointer ${
                        isOn ? "bg-primary text-primary-foreground border-primary" : "bg-background"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isOn}
                        onChange={(e) =>
                          setSelectedValueIds((cur) =>
                            e.target.checked
                              ? [...cur, v.id]
                              : cur.filter((id) => id !== v.id)
                          )
                        }
                      />
                      {v.value}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Δεν υπάρχουν αχρησιμοποίητες τιμές. Δημιουργήστε νέες παρακάτω.
            </p>
          )}

          <div className="pt-2 border-t border-muted space-y-1.5">
            <input
              value={newValueText}
              onChange={(e) => setNewValueText(e.target.value)}
              placeholder="Νέα τιμή… (π.χ. Red, Blue, Green)"
              disabled={isPending}
              className="cms-input cms-input-sm w-full"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground italic">
                Διαχωρίστε με κόμμα για πολλαπλή προσθήκη
              </span>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isPending || !newValueText.trim()}
                className="btn btn-secondary btn-sm"
              >
                + Δημιουργία
              </button>
            </div>
          </div>

          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || selectedValueIds.length === 0}
              className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs"
            >
              Προσθήκη επιλεγμένων ({selectedValueIds.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSelectedValueIds([]);
                setNewValueText("");
                setError(null);
              }}
              className="btn btn-secondary btn-sm"
            >
              Άκυρο
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Minimal "+ Νέος άξονας" trigger. Picks an attribute (or creates a
 * new attribute type inline) → stages an EMPTY axis in the parent.
 * Value entry then happens in the staged AxisPanel itself, using
 * the exact same widget the admin uses for committed axes. This is
 * what makes first-axis and additional-axis flows identical:
 * there's no longer a parallel "add axis form" with its own value
 * pickers — there's just "stage an axis" and "add values to an axis".
 */
function AddNewAxisPanel({
  attributes,
  excludeAttributeSlugs,
  isPending,
  onPickAttribute,
  onCreateAttribute,
}: {
  attributes: Attribute[];
  excludeAttributeSlugs: Set<string>;
  isPending: boolean;
  onPickAttribute: (attributeId: string) => void;
  onCreateAttribute: (a: Attribute) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creatingNewAttr, setCreatingNewAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const candidateAttrs = attributes.filter(
    (a) => !excludeAttributeSlugs.has(a.slug)
  );

  function reset() {
    setOpen(false);
    setCreatingNewAttr(false);
    setNewAttrName("");
    setError(null);
  }

  function handleSelectExisting(attributeId: string) {
    if (!attributeId || attributeId === "__new__") {
      if (attributeId === "__new__") setCreatingNewAttr(true);
      return;
    }
    onPickAttribute(attributeId);
    reset();
  }

  function handleCreateAttr() {
    setError(null);
    const name = newAttrName.trim();
    if (!name) return;
    startTransition(async () => {
      const r = await createAttribute({ name });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onCreateAttribute(r.data);
      onPickAttribute(r.data.id);
      reset();
    });
  }

  if (!open) {
    // Trigger styled as an axis-shaped tile with a DASHED border —
    // matches the staged AxisPanel border style so the visual story
    // is "this is where you stage another axis". h-full + min-h
    // keeps it aligned with neighboring AxisPanel tiles regardless
    // of how many values they contain.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="rounded-md border-2 border-dashed border-foreground/30 hover:border-foreground hover:bg-muted/30 px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent inline-flex items-center justify-center gap-1.5 text-foreground/70 hover:text-foreground self-stretch"
      >
        <span className="text-base leading-none">+</span>
        Νέος άξονας
      </button>
    );
  }

  return (
    <fieldset className="rounded-md border-2 border-dashed border-foreground/40 bg-card p-3 max-w-full space-y-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.05)]">
      <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-1">
        Νέος άξονας
      </legend>

      {!creatingNewAttr && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => handleSelectExisting(e.target.value)}
          className="cms-input cms-input-sm"
          disabled={isPending}
        >
          <option value="" disabled>
            — επιλέξτε χαρακτηριστικό —
          </option>
          {candidateAttrs.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="__new__">+ Νέος τύπος…</option>
        </select>
      )}

      {creatingNewAttr && (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={newAttrName}
            onChange={(e) => setNewAttrName(e.target.value)}
            placeholder="Όνομα νέου τύπου"
            className="cms-input cms-input-sm flex-1"
            disabled={isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateAttr();
              }
            }}
          />
          <button
            type="button"
            onClick={handleCreateAttr}
            disabled={isPending || !newAttrName.trim()}
            className="btn btn-primary btn-sm"
          >
            Δημιουργία
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={reset}
        disabled={isPending}
        className="btn btn-secondary btn-sm"
      >
        Άκυρο
      </button>
    </fieldset>
  );
}

function BulkPriceControl({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (price: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="rounded border border-foreground/30 hover:border-foreground hover:bg-muted/50 px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
      >
        Bulk τιμή
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="0.01"
        min={0}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Τιμή"
        autoFocus
        className="border rounded px-2 py-1 text-xs w-20 font-mono text-center"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(price);
          if (Number.isFinite(n) && n >= 0) {
            onApply(n);
            setOpen(false);
            setPrice("");
          }
        }}
        disabled={disabled || !price}
        className="rounded border border-foreground hover:bg-foreground hover:text-background px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground"
      >
        Εφαρμογή
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setPrice("");
        }}
        className="text-xs text-muted-foreground underline"
      >
        Ακύρωση
      </button>
    </div>
  );
}

/**
 * Inline labeled numeric input + apply button.
 *
 * Used inside the selected-variants bulk-action bar for price, stock,
 * and threshold setters. Each instance is a self-contained control —
 * type a value, press Enter or click "Εφαρμογή", parent's onApply
 * fires with the numeric value. After apply the input clears so the
 * next batch can start fresh.
 *
 * The same UX pattern (inline label, narrow numeric field, primary
 * apply button) is reused for all three setters so the bar reads as
 * a consistent row of related controls rather than three disparate
 * affordances.
 */
function BulkNumericControl({
  label,
  placeholder,
  step,
  min,
  allowDecimal,
  disabled,
  onApply,
}: {
  label: string;
  placeholder: string;
  step: string;
  min: number;
  allowDecimal?: boolean;
  disabled: boolean;
  onApply: (n: number) => void;
}) {
  const [value, setValue] = useState("");

  function apply() {
    const parsed = allowDecimal ? Number(value) : parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) return;
    onApply(parsed);
    setValue("");
  }

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium text-foreground/70 whitespace-nowrap">
        {label}:
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
        placeholder={placeholder}
        step={step}
        min={min}
        disabled={disabled}
        className="w-20 h-7 px-2 text-xs rounded border border-foreground/20 bg-background focus:outline-none focus:border-foreground"
      />
      <button
        type="button"
        onClick={apply}
        disabled={disabled || !value}
        className="rounded border border-foreground hover:bg-foreground hover:text-background px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground"
      >
        ✓
      </button>
    </div>
  );
}
