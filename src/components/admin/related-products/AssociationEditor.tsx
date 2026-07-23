"use client";

import { useState, useTransition } from "react";
import { ArrowRight, ChevronDown, FlaskConical, AlertTriangle, Search, X } from "lucide-react";
import {
  updateRelatedProductsAssociation,
  deleteRelatedProductsAssociation,
  createFilterGroup,
  deleteFilterGroup,
  createFilterCondition,
  updateFilterCondition,
  deleteFilterCondition,
  addManualPick,
  removeManualPick,
  reorderManualPicks,
  debugResolveCarousels,
} from "@/actions/related-products";
import WorkshopToggle from "@/components/admin/common/WorkshopToggle";
import FilterSideEditor from "./FilterSideEditor";
import ManualPicksEditor from "./ManualPicksEditor";
import type {
  ResolvedCarousel,
  ResolverWarning,
} from "@/lib/related-products";
import type { FilterLookups } from "./_lookups";
import type {
  RelatedProductsAssociationFull,
  RelatedProductsSelectionStrategy,
  RelatedProductsCardGranularity,
  RelatedProductsSide,
  RelatedProductsConditionKind,
  RelatedProductsFilterGroupWithConditions,
  Translations,
} from "@/types/related-products";

type AssociationPatch = Partial<{
  name: string;
  message_title_translations: Translations;
  active: boolean;
  display_order: number;
  bidirectional: boolean;
  exclude_oos: boolean;
  selection_strategy: RelatedProductsSelectionStrategy;
  max_results: number;
  card_granularity: RelatedProductsCardGranularity;
}>;

interface Props {
  association: RelatedProductsAssociationFull;
  lookups: FilterLookups;
  /** Triggered after filter mutations so the parent can refresh from
   *  the server (we don't reconstruct nested composite shapes for
   *  filter changes optimistically). */
  onFiltersChanged: () => void;
  /** Triggered when the merchant deletes the association. The bench
   *  removes the accordion item it lives in. */
  onDeleted: () => void;
  /** Products + variants picker dataset for the per-relationship test
   *  panel at the bottom of the editor. Same shape the bench-wide
   *  test drawer uses. */
  products: Array<{ id: string; name: string }>;
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
}

/**
 * Editor body for a single related-products association. Renders the
 * sentence-form configuration (title + position + bidirectional, then
 * the source→target filter sentence, then the behavior sentence) plus
 * a per-relationship "Τέστ Live Προτεινόμενων" panel at the bottom.
 *
 * No top header row — the surrounding accordion item carries the
 * always-visible header (CMS name + chip sentence + active toggle +
 * delete + chevron), so this component focuses on the editable
 * configuration.
 */
export default function AssociationEditor({
  association,
  lookups,
  onFiltersChanged,
  onDeleted,
  products,
  variants,
}: Props) {
  const [, startTransition] = useTransition();
  const [local, setLocal] =
    useState<RelatedProductsAssociationFull>(association);
  const [error, setError] = useState<string | null>(null);

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  function patch(p: AssociationPatch) {
    setLocal((a) => ({ ...a, ...p }));
    startTransition(async () => {
      const r = await updateRelatedProductsAssociation({
        id: local.id,
        ...p,
      });
      if (!r.success) {
        setLocal(association);
        flashError(r.error);
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Διαγραφή συσχέτισης «${local.name}»; Δεν επαναφέρεται.`
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteRelatedProductsAssociation({ id: local.id });
      if (!r.success) return flashError(r.error);
      onDeleted();
    });
  }

  // ─── Filter handlers (groups + conditions) ───────────────────────
  //
  // We update local state optimistically by mutating the source/target
  // group lists, then call the parent's onFiltersChanged() so the
  // bench can router.refresh() and pull canonical rows.

  function addGroup(side: RelatedProductsSide) {
    startTransition(async () => {
      const r = await createFilterGroup({
        association_id: local.id,
        side,
      });
      if (!r.success) return flashError(r.error);
      const newGroup: RelatedProductsFilterGroupWithConditions = {
        ...r.data,
        conditions: [],
      };
      setLocal((a) => ({
        ...a,
        ...(side === "source"
          ? { source_groups: [...a.source_groups, newGroup] }
          : { target_groups: [...a.target_groups, newGroup] }),
      }));
      onFiltersChanged();
    });
  }

  function removeGroup(side: RelatedProductsSide, group_id: string) {
    setLocal((a) => ({
      ...a,
      ...(side === "source"
        ? {
            source_groups: a.source_groups.filter((g) => g.id !== group_id),
          }
        : {
            target_groups: a.target_groups.filter((g) => g.id !== group_id),
          }),
    }));
    startTransition(async () => {
      const r = await deleteFilterGroup({ id: group_id });
      if (!r.success) {
        setLocal(association);
        return flashError(r.error);
      }
      onFiltersChanged();
    });
  }

  function addCondition(
    side: RelatedProductsSide,
    group_id: string,
    input: {
      kind: RelatedProductsConditionKind;
      config: Record<string, unknown>;
      negate: boolean;
    }
  ) {
    startTransition(async () => {
      // Server-action's discriminated union needs (kind + config) typed
      // together — we cast through `as never` since the union is wide.
      const r = await createFilterCondition({
        filter_group_id: group_id,
        kind: input.kind,
        config: input.config,
        negate: input.negate,
      } as Parameters<typeof createFilterCondition>[0]);
      if (!r.success) return flashError(r.error);
      setLocal((a) => {
        const updater = (
          groups: RelatedProductsFilterGroupWithConditions[]
        ) =>
          groups.map((g) =>
            g.id === group_id
              ? { ...g, conditions: [...g.conditions, r.data] }
              : g
          );
        return {
          ...a,
          ...(side === "source"
            ? { source_groups: updater(a.source_groups) }
            : { target_groups: updater(a.target_groups) }),
        };
      });
      onFiltersChanged();
    });
  }

  function patchCondition(
    side: RelatedProductsSide,
    condition_id: string,
    patch: Partial<{ config: Record<string, unknown>; negate: boolean }>
  ) {
    setLocal((a) => {
      // The discriminated union on `config` widens to Record<string,unknown>
      // when we spread the patch in, so we cast the merged row back to
      // the canonical type. Server already validated the shape via the
      // condition's `kind`-bound zod schema.
      const updater = (
        groups: RelatedProductsFilterGroupWithConditions[]
      ) =>
        groups.map((g) => ({
          ...g,
          conditions: g.conditions.map((c) => {
            if (c.id !== condition_id) return c;
            const merged = {
              ...c,
              ...(patch.negate !== undefined ? { negate: patch.negate } : {}),
              ...(patch.config !== undefined ? { config: patch.config } : {}),
            };
            return merged as typeof c;
          }),
        }));
      return {
        ...a,
        ...(side === "source"
          ? { source_groups: updater(a.source_groups) }
          : { target_groups: updater(a.target_groups) }),
      };
    });
    startTransition(async () => {
      const r = await updateFilterCondition({
        id: condition_id,
        ...patch,
      });
      if (!r.success) {
        setLocal(association);
        return flashError(r.error);
      }
      onFiltersChanged();
    });
  }

  function removeCondition(
    side: RelatedProductsSide,
    condition_id: string
  ) {
    setLocal((a) => {
      const updater = (
        groups: RelatedProductsFilterGroupWithConditions[]
      ) =>
        groups.map((g) => ({
          ...g,
          conditions: g.conditions.filter((c) => c.id !== condition_id),
        }));
      return {
        ...a,
        ...(side === "source"
          ? { source_groups: updater(a.source_groups) }
          : { target_groups: updater(a.target_groups) }),
      };
    });
    startTransition(async () => {
      const r = await deleteFilterCondition({ id: condition_id });
      if (!r.success) {
        setLocal(association);
        return flashError(r.error);
      }
      onFiltersChanged();
    });
  }

  // ─── Manual picks handlers ───────────────────────────────────────
  function addPick(product_id: string) {
    startTransition(async () => {
      const r = await addManualPick({
        association_id: local.id,
        product_id,
      });
      if (!r.success) return flashError(r.error);
      setLocal((a) => ({
        ...a,
        manual_picks: [...a.manual_picks, r.data],
      }));
      onFiltersChanged();
    });
  }

  function removePick(pick_id: string) {
    setLocal((a) => ({
      ...a,
      manual_picks: a.manual_picks.filter((p) => p.id !== pick_id),
    }));
    startTransition(async () => {
      const r = await removeManualPick({ id: pick_id });
      if (!r.success) {
        setLocal(association);
        return flashError(r.error);
      }
      onFiltersChanged();
    });
  }

  function reorderPicks(ordered_ids: string[]) {
    // Optimistically update sort_order locally so the up/down clicks
    // feel instant. Server applies the same order on success.
    setLocal((a) => {
      const byId = new Map(a.manual_picks.map((p) => [p.id, p]));
      const next = ordered_ids
        .map((id, i) => {
          const existing = byId.get(id);
          return existing ? { ...existing, sort_order: i } : null;
        })
        .filter((p): p is (typeof a.manual_picks)[number] => p !== null);
      return { ...a, manual_picks: next };
    });
    startTransition(async () => {
      const r = await reorderManualPicks({
        association_id: local.id,
        ordered_ids,
      });
      if (!r.success) {
        setLocal(association);
        return flashError(r.error);
      }
      onFiltersChanged();
    });
  }

  return (
    <div className="space-y-8">
      {/* No top header here — the surrounding accordion item shows the
          CMS name + chip sentence + active toggle + delete + chevron. */}

      {/* CMS internal name input. Tucked at the very top so the admin
          can rename inline without leaving the accordion. */}
      <label className="block">
        <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Εσωτερικό όνομα
        </span>
        <input
          type="text"
          value={local.name}
          onChange={(e) => patch({ name: e.target.value })}
          maxLength={200}
          className="cms-input w-full max-w-lg"
        />
        <span className="block text-[10px] text-muted-foreground mt-1">
          Φαίνεται μόνο εδώ στο CMS, όχι στους πελάτες.
        </span>
      </label>

      {/* ─── Row 1: Title + Position + Bidirectional ────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-10">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Τίτλος</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Εμφανίζεται ως τίτλος για αυτή την συσχέτιση προτεινόμενων.
          </p>
          <input
            type="text"
            value={local.message_title_translations.el ?? ""}
            onChange={(e) =>
              patch({
                message_title_translations: {
                  ...local.message_title_translations,
                  el: e.target.value,
                },
              })
            }
            placeholder="π.χ. Ταιριάζει υπέροχα με αυτά"
            maxLength={200}
            className="cms-input w-full max-w-lg mt-3"
          />
        </div>

        <div className="flex flex-col gap-3 lg:items-end lg:pt-1">
          <div className="flex items-center gap-2 text-sm flex-wrap lg:justify-end">
            <span>Αυτή η συσχέτιση να εμφανίζεται</span>
            <input
              type="number"
              min={1}
              value={local.display_order}
              onChange={(e) =>
                patch({
                  display_order: Math.max(
                    1,
                    parseInt(e.target.value, 10) || 1
                  ),
                })
              }
              aria-label="Θέση από πάνω (1 = πιο πάνω)"
              className="cms-input w-16 text-center"
            />
            <span>η από πάνω σε σειρά</span>
          </div>
          <label className="flex items-center gap-2 text-sm lg:justify-end cursor-pointer">
            <span>Ισχύει και Αντίστροφα</span>
            <WorkshopToggle
              active={local.bidirectional}
              onChange={(next) => patch({ bidirectional: next })}
              ariaLabel="Ισχύει και Αντίστροφα"
            />
          </label>
        </div>
      </div>

      {/* Hard separator between the top "what + where" block and the
          configuration sentences below. */}
      <hr className="border-t border-border" />

      {/* ─── Configuration block ───────────────────────────────────
          Two sibling sentences live here: the filter sentence
          (source → target) and the behavior sentence. A subtle dashed
          divider between them signals they're peers under the same
          umbrella ("how this association behaves").                  */}
      <div className="space-y-6">
        {/* Row 2: filter sentence — two halves of one continuous
            sentence on wide screens, stacked on narrow. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 items-start">
          <div>
            <p className="text-sm font-medium mb-2">
              Όταν ο Πελάτης βλέπει
            </p>
            <FilterSideEditor
              side="source"
              groups={local.source_groups}
              lookups={lookups}
              onAddGroup={() => addGroup("source")}
              onDeleteGroup={(id) => removeGroup("source", id)}
              onAddCondition={(gid, input) =>
                addCondition("source", gid, input)
              }
              onPatchCondition={(cid, p) =>
                patchCondition("source", cid, p)
              }
              onDeleteCondition={(cid) => removeCondition("source", cid)}
            />
          </div>
          <div>
            <p className="text-sm font-medium mb-2 inline-flex items-center gap-2">
              <ArrowRight
                className="w-4 h-4 text-muted-foreground"
                aria-hidden
              />
              Η σελίδα του προτείνει
            </p>
            <FilterSideEditor
              side="target"
              groups={local.target_groups}
              lookups={lookups}
              onAddGroup={() => addGroup("target")}
              onDeleteGroup={(id) => removeGroup("target", id)}
              onAddCondition={(gid, input) =>
                addCondition("target", gid, input)
              }
              onPatchCondition={(cid, p) =>
                patchCondition("target", cid, p)
              }
              onDeleteCondition={(cid) => removeCondition("target", cid)}
            />
          </div>
        </div>

        {/* Soft sibling-divider between the two configuration
            sentences. Dashed + narrower than the hard separator so
            it reads as "next sentence" instead of "next section". */}
        <div className="border-t border-dashed border-foreground/10" />

        {/* Row 3: behavior sentence. */}
        <div className="flex items-center gap-2 flex-wrap text-sm leading-9">
          <span>Τα προτεινόμενα προϊόντα, εμφανίζονται</span>
          <InlineChipSelect<RelatedProductsSelectionStrategy>
            value={local.selection_strategy}
            onChange={(v) => patch({ selection_strategy: v })}
            options={[
              { value: "random", label: "σε τυχαία σειρά" },
              { value: "recent", label: "βάση ημερομηνίας παραλαβής" },
              { value: "manual", label: "όπως θα επιλέξω" },
            ]}
            ariaLabel="Στρατηγική επιλογής"
          />
          <span>με</span>
          <InlineChipSelect<RelatedProductsCardGranularity>
            value={local.card_granularity}
            onChange={(v) => patch({ card_granularity: v })}
            options={[
              {
                value: "variant",
                label: "κάρτα παραλλαγής",
                suffix: "(προτείνεται)",
              },
              { value: "product", label: "κάρτα προϊόντος" },
            ]}
            ariaLabel="Είδος καρτέλας"
          />
          <span>για έως</span>
          <input
            type="number"
            min={1}
            max={24}
            value={local.max_results}
            onChange={(e) =>
              patch({
                max_results: Math.max(
                  1,
                  Math.min(24, parseInt(e.target.value, 10) || 1)
                ),
              })
            }
            aria-label="Μέγιστα αποτελέσματα"
            className="cms-input w-16 text-center"
          />
          <span>προϊόντα διαθεσιμότητας</span>
          <InlineChipSelect<"in_stock" | "all">
            value={local.exclude_oos ? "in_stock" : "all"}
            onChange={(v) => patch({ exclude_oos: v === "in_stock" })}
            options={[
              { value: "in_stock", label: "Μόνο Διαθέσιμα" },
              { value: "all", label: "Όλα" },
            ]}
            ariaLabel="Φιλτράρισμα αποθέματος"
          />
        </div>
      </div>

      {/* Manual picks — only visible when strategy=manual OR picks
          already exist (so the admin doesn't lose them silently when
          switching strategies). */}
      {(local.selection_strategy === "manual" ||
        local.manual_picks.length > 0) && (
        <section>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Χειροκίνητη σειρά προϊόντων
          </h4>
          {local.selection_strategy !== "manual" && (
            <p className="text-[10px] text-amber-700 italic mb-2">
              ⚠ Η στρατηγική δεν είναι «Χειροκίνητα» — οι παρακάτω
              επιλογές αποθηκεύονται αλλά δεν χρησιμοποιούνται για την
              ώρα.
            </p>
          )}
          <ManualPicksEditor
            picks={local.manual_picks}
            products={lookups.products}
            onAdd={addPick}
            onRemove={removePick}
            onReorder={reorderPicks}
          />
        </section>
      )}

      {/* Hard separator before the per-relationship test panel — it's
          a developer/admin tool, not part of the configuration. */}
      <hr className="border-t border-border" />

      <AssociationTestPanel
        associationId={local.id}
        products={products}
        variants={variants}
      />

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Per-relationship "Τέστ Live Προτεινόμενων" panel. Lets the admin
 * pick a product (+ optional variant) and see what THIS association
 * alone would produce on that product's page — independent of other
 * associations and regardless of its current `active` flag.
 *
 * Lives inside the expanded accordion item; the bench-wide drawer
 * remains the way to test ALL active associations together.
 */
function AssociationTestPanel({
  associationId,
  products,
  variants,
}: {
  associationId: string;
  products: Array<{ id: string; name: string }>;
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [carousels, setCarousels] = useState<ResolvedCarousel[] | null>(null);
  const [warnings, setWarnings] = useState<ResolverWarning[]>([]);
  const [testError, setTestError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredProducts = productQuery.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(productQuery.toLowerCase())
      )
    : products;
  const variantsForProduct = productId
    ? variants.filter((v) => v.product_id === productId)
    : [];
  const selectedProductName =
    products.find((p) => p.id === productId)?.name ?? null;

  function runTest() {
    if (!productId) return;
    setTestError(null);
    startTransition(async () => {
      const r = await debugResolveCarousels({
        product_id: productId,
        variant_id: variantId,
        only_association_id: associationId,
      });
      if (!r.success) {
        setTestError(r.error);
        return;
      }
      setCarousels(r.data.carousels);
      setWarnings(r.data.warnings);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm flex items-center gap-1.5"
      >
        <FlaskConical className="w-4 h-4" />
        <span>Τέστ Live Προτεινόμενων για αυτή τη συσχέτιση</span>
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">
          Τέστ Live Προτεινόμενων
        </h4>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setProductId(null);
            setVariantId(null);
            setCarousels(null);
            setWarnings([]);
            setTestError(null);
          }}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Κλείσιμο πάνελ τεστ"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Product picker */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder="Αναζήτηση προϊόντος…"
            className="cms-input pl-8 w-full"
          />
        </div>
        {selectedProductName ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
            <span className="truncate">{selectedProductName}</span>
            <button
              type="button"
              onClick={() => {
                setProductId(null);
                setVariantId(null);
                setCarousels(null);
                setWarnings([]);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Καθαρισμός"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <ul className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-md p-1 bg-background">
            {filteredProducts.length === 0 ? (
              <li className="text-xs text-muted-foreground italic px-2 py-1">
                Κανένα προϊόν.
              </li>
            ) : (
              filteredProducts.slice(0, 40).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setProductId(p.id);
                      setVariantId(null);
                      setCarousels(null);
                      setWarnings([]);
                    }}
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted/60"
                  >
                    {p.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {productId && variantsForProduct.length > 0 && (
        <label className="block text-sm">
          <span className="block text-xs text-muted-foreground mb-1">
            Παραλλαγή (προαιρετικά)
          </span>
          <select
            value={variantId ?? ""}
            onChange={(e) => setVariantId(e.target.value || null)}
            className="cms-input w-full"
          >
            <option value="">— χωρίς παραλλαγή —</option>
            {variantsForProduct.map((v) => (
              <option key={v.id} value={v.id}>
                {v.sku}
              </option>
            ))}
          </select>
        </label>
      )}

      {productId && (
        <button
          type="button"
          onClick={runTest}
          disabled={isPending}
          className="btn btn-primary btn-sm"
        >
          {isPending ? "Εκτέλεση…" : "Εκτέλεση τεστ"}
        </button>
      )}

      {testError && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">
          {testError}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {w.kind === "bidirectional_overlap" && (
                <span>
                  Αυτό το προϊόν ταιριάζει ΚΑΙ στα φίλτρα πηγής ΚΑΙ στα
                  φίλτρα στόχου. Ο engine κράτησε την κανονική
                  κατεύθυνση (πηγή → στόχος).
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {carousels !== null && (
        <div>
          <h5 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Αποτέλεσμα
          </h5>
          {carousels.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Η συσχέτιση δεν θα εμφανίσει καρουζέλ για αυτό το προϊόν.
            </p>
          ) : (
            <div className="space-y-2">
              {carousels.map((c) => (
                <article
                  key={c.association_id + (c.direction ?? "")}
                  className="rounded-md border border-border bg-background p-2 text-xs"
                >
                  <p className="font-semibold mb-1">
                    {c.title_translations.el ??
                      c.title_translations.en ?? (
                        <span className="text-muted-foreground italic">
                          «Προτεινόμενα Προϊόντα» (fallback)
                        </span>
                      )}
                    {c.direction === "reverse" && (
                      <span className="ml-2 text-[10px] font-mono uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">
                        αντίστροφα
                      </span>
                    )}
                  </p>
                  <ul className="space-y-0.5">
                    {c.products.map((p, idx) => (
                      <li key={p.id} className="flex gap-2">
                        <span className="text-muted-foreground tabular-nums w-5">
                          {idx + 1}.
                        </span>
                        <span className="truncate">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

/**
 * A chip-styled inline select. Renders like a button with the current
 * label shown; opening the native popup uses a transparent <select>
 * overlay so we get OS-native accessibility, keyboard nav and a11y
 * announcements without reimplementing them.
 */
function InlineChipSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; suffix?: string }>;
  ariaLabel: string;
}) {
  const selected = options.find((o) => o.value === value) ?? options[0];
  return (
    <span className="relative inline-flex items-center">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border border-foreground/15 text-foreground/90 font-medium hover:bg-muted">
        <span>{selected.label}</span>
        {selected.suffix && (
          <span className="text-[10px] text-muted-foreground font-normal">
            {selected.suffix}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden />
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
            {opt.suffix ? ` ${opt.suffix}` : ""}
          </option>
        ))}
      </select>
    </span>
  );
}

