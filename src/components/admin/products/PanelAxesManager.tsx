"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { createAttribute } from "@/actions/attributes/createAttribute";
import { createAttributeValuesBulk } from "@/actions/attributes/createAttributeValuesBulk";
import Toggle from "@/components/admin/common/Toggle";

/**
 * Axes manager — Region A of the panel's Variants tab. Mirrors the
 * visual idiom of <AxisPanel> in AxesEditor (fieldset + legend +
 * value chips + dashed "+ Προσθήκη" affordance + inline picker) so
 * the panel feels like a continuation of the edit page rather than a
 * parallel UI.
 *
 * State model:
 *   - committedAxes: derived from variants' attribute_combo. These axes
 *     can grow (admin adds values) but can't shrink without deleting
 *     variants — value removal on a committed axis isn't exposed here.
 *   - extraValuesByAxis: values the admin has added to a committed axis
 *     that haven't been materialised as variants yet. Kept in local
 *     state so the matrix expansion is visible immediately; Step 4
 *     reads these to generate preview cards.
 *   - pendingAxes: brand-new axes (existing attribute or new) staged
 *     locally. Each pending axis carries its own value list. Again,
 *     local-only until Step 4 commits them as variants.
 *
 * The bottom of this component does NOT yet render preview cards —
 * that's wired up in Step 4. For now, the manager surface lets admins
 * grow the matrix; the variants list below shows real cards only.
 */

export interface PendingAxis {
  attributeId: string;
  attributeSlug: string;
  attributeName: string;
  /** Order matters — admins curate the value sequence within an axis. */
  valueIds: string[];
}

interface AttributeRow {
  id: string;
  slug: string;
  name: string;
  /** Global default — whether this attribute splits the storefront
   *  listing into separate cards. The per-product override (passed via
   *  splitOverrides) takes precedence when present. */
  splits_listing: boolean;
}

interface AttributeValueRow {
  id: string;
  attribute_id: string;
  value: string;
  display_order: number;
}

interface Variant {
  variant_id: string;
  attribute_combo: Record<string, string> | null;
}

interface Props {
  productId: string;
  variants: Variant[];
  allAttributes: AttributeRow[];
  allAttributeValues: AttributeValueRow[];
  /** Controlled state — owned by the parent (VariantsList) so the
   *  preview cards below the manager can see the same staging. */
  pendingAxes: PendingAxis[];
  setPendingAxes: (
    updater: PendingAxis[] | ((cur: PendingAxis[]) => PendingAxis[])
  ) => void;
  extraValuesByAxis: Record<string, string[]>;
  setExtraValuesByAxis: (
    updater:
      | Record<string, string[]>
      | ((cur: Record<string, string[]>) => Record<string, string[]>)
  ) => void;
  /**
   * Per-attribute split-listing override map. Each axis container
   * renders a toggle that reads from this map (falling back to the
   * attribute's global splits_listing default) and writes via
   * onSplitChange when toggled.
   */
  splitOverrides: Record<string, boolean>;
  onSplitChange: (slug: string, next: boolean) => void;
  /** Refetch the panel bundle + table after creating an attribute/value so
   *  the new data (allAttributes / allAttributeValues) flows back in. */
  reload: () => void;
}

export default function PanelAxesManager({
  productId,
  variants,
  allAttributes,
  allAttributeValues,
  pendingAxes,
  setPendingAxes,
  extraValuesByAxis,
  setExtraValuesByAxis,
  splitOverrides,
  onSplitChange,
  reload,
}: Props) {

  // Lookup maps for O(1) reads inside render.
  const valueById = useMemo(() => {
    const m = new Map<string, AttributeValueRow>();
    for (const v of allAttributeValues) m.set(v.id, v);
    return m;
  }, [allAttributeValues]);

  // Committed axes — derived from this product's existing variants.
  const committedAxes = useMemo(() => {
    const slugToValueIds = new Map<string, Set<string>>();
    for (const v of variants) {
      if (!v.attribute_combo) continue;
      for (const [slug, valueId] of Object.entries(v.attribute_combo)) {
        const set = slugToValueIds.get(slug) ?? new Set<string>();
        set.add(valueId);
        slugToValueIds.set(slug, set);
      }
    }
    type Axis = {
      slug: string;
      valueIds: string[];
      attribute: AttributeRow;
    };
    const axes: Axis[] = [];
    for (const [slug, valueIds] of slugToValueIds) {
      const attr = allAttributes.find((a) => a.slug === slug);
      if (!attr) continue;
      const extras = extraValuesByAxis[slug] ?? [];
      axes.push({
        slug,
        valueIds: [...Array.from(valueIds), ...extras],
        attribute: attr,
      });
    }
    return axes;
  }, [variants, allAttributes, extraValuesByAxis]);

  const axesUsedSlugs = new Set([
    ...committedAxes.map((a) => a.slug),
    ...pendingAxes.map((p) => p.attributeSlug),
  ]);

  // ── Handlers ──────────────────────────────────────────────────────

  function handleAddValuesToCommitted(
    attributeId: string,
    valueIds: string[]
  ) {
    const attr = allAttributes.find((a) => a.id === attributeId);
    if (!attr) return;
    setExtraValuesByAxis((cur) => {
      const existing = cur[attr.slug] ?? [];
      const merged = Array.from(new Set([...existing, ...valueIds]));
      return { ...cur, [attr.slug]: merged };
    });
  }

  function handleAddValuesToPending(attributeId: string, valueIds: string[]) {
    setPendingAxes((cur) =>
      cur.map((pa) =>
        pa.attributeId === attributeId
          ? {
              ...pa,
              valueIds: Array.from(new Set([...pa.valueIds, ...valueIds])),
            }
          : pa
      )
    );
  }

  function handleRemovePendingValue(attributeId: string, valueId: string) {
    setPendingAxes((cur) =>
      cur.map((pa) =>
        pa.attributeId === attributeId
          ? { ...pa, valueIds: pa.valueIds.filter((v) => v !== valueId) }
          : pa
      )
    );
  }

  function handleRemoveExtraValue(slug: string, valueId: string) {
    setExtraValuesByAxis((cur) => ({
      ...cur,
      [slug]: (cur[slug] ?? []).filter((v) => v !== valueId),
    }));
  }

  function handleStageAxis(attribute: AttributeRow) {
    setPendingAxes((cur) => [
      ...cur,
      {
        attributeId: attribute.id,
        attributeSlug: attribute.slug,
        attributeName: attribute.name,
        valueIds: [],
      },
    ]);
  }

  function handleRemovePending(attributeId: string) {
    setPendingAxes((cur) => cur.filter((p) => p.attributeId !== attributeId));
  }

  // ── Render ────────────────────────────────────────────────────────

  // All axis cards (committed first, then pending) as a flat list so they
  // can be joined by the "×" glyph that mirrors the Cartesian product.
  const renderedAxes: { key: string; node: React.ReactNode }[] = [
    ...committedAxes.map((axis) => {
      // Resolve effective split state: per-product override wins; otherwise
      // fall back to the attribute's global splits_listing.
      const splitOverride = splitOverrides[axis.slug];
      const isSplit =
        splitOverride === undefined
          ? axis.attribute.splits_listing
          : splitOverride;
      return {
        key: axis.slug,
        node: (
          <AxisContainer
            axis={axis}
            valueById={valueById}
            allAttributeValues={allAttributeValues}
            extraValueIds={extraValuesByAxis[axis.slug] ?? []}
            splitState={{
              isSplit,
              isExplicitOverride: splitOverride !== undefined,
              onToggle: (next) => onSplitChange(axis.slug, next),
            }}
            onAddValues={(vids) =>
              handleAddValuesToCommitted(axis.attribute.id, vids)
            }
            onRemoveExtraValue={(vid) =>
              handleRemoveExtraValue(axis.slug, vid)
            }
            reload={reload}
          />
        ),
      };
    }),
    ...pendingAxes.map((pa) => ({
      key: `pending-${pa.attributeId}`,
      node: (
        <AxisContainer
          axis={{
            slug: pa.attributeSlug,
            valueIds: pa.valueIds,
            attribute: {
              id: pa.attributeId,
              slug: pa.attributeSlug,
              name: pa.attributeName,
              // Carried over from allAttributes when available; defaulted to
              // false for axes pending creation (the split toggle only
              // renders for committed axes, so this field is unread here).
              splits_listing:
                allAttributes.find((a) => a.id === pa.attributeId)
                  ?.splits_listing ?? false,
            },
          }}
          staged
          valueById={valueById}
          allAttributeValues={allAttributeValues}
          onAddValues={(vids) => handleAddValuesToPending(pa.attributeId, vids)}
          onRemoveValue={(vid) =>
            handleRemovePendingValue(pa.attributeId, vid)
          }
          onRemoveAxis={() => handleRemovePending(pa.attributeId)}
          reload={reload}
        />
      ),
    })),
  ];

  return (
    <section className="mb-4 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-3">
      {/* Helper text */}
      <p className="text-[11px] text-muted-foreground mb-3">
        Κάθε άξονας είναι ένα χαρακτηριστικό (π.χ. Χρώμα, Μέγεθος) με τις
        τιμές του. Νέες τιμές δημιουργούν συνδυασμούς προεπισκόπησης παρακάτω.
      </p>

      {/* Axes list — each axis card joined by a "×" glyph (the Cartesian
          product the variants form), then the new-axis tile. */}
      <div className="flex flex-wrap items-stretch gap-2">
        {renderedAxes.map((ra, i) => (
          <Fragment key={ra.key}>
            {i > 0 && <AxisCross />}
            {ra.node}
          </Fragment>
        ))}
        <AddAxisTile
          attributes={allAttributes}
          excludeSlugs={axesUsedSlugs}
          onPick={handleStageAxis}
          reload={reload}
        />
      </div>
    </section>
  );
}

/* ── "×" separator between axis cards ─────────────────────────────── */

function AxisCross() {
  return (
    <span
      className="self-center select-none px-0.5 text-lg font-light text-foreground/40"
      aria-hidden
    >
      ×
    </span>
  );
}

/* ── Axis container ───────────────────────────────────────────────── */

interface AxisShape {
  slug: string;
  valueIds: string[];
  attribute: AttributeRow;
}

function AxisContainer({
  axis,
  valueById,
  allAttributeValues,
  extraValueIds,
  staged = false,
  splitState,
  onAddValues,
  onRemoveValue,
  onRemoveExtraValue,
  onRemoveAxis,
  reload,
}: {
  axis: AxisShape;
  valueById: Map<string, AttributeValueRow>;
  allAttributeValues: AttributeValueRow[];
  /** Only for committed axes — value IDs that exist only in the local
   *  "extras" buffer (not yet on any variant). Get an "×" affordance
   *  to undo before commit. */
  extraValueIds?: string[];
  staged?: boolean;
  /** Card-split rules — only meaningful for committed axes. When set,
   *  the container renders a toggle controlling whether this axis
   *  splits the storefront listing into separate cards. */
  splitState?: {
    isSplit: boolean;
    isExplicitOverride: boolean;
    onToggle: (next: boolean) => void;
  };
  onAddValues: (valueIds: string[]) => void;
  onRemoveValue?: (valueId: string) => void;
  onRemoveExtraValue?: (valueId: string) => void;
  onRemoveAxis?: () => void;
  /** Refetch the panel bundle after creating values, so new values render
   *  with their real labels (not "(?)"). */
  reload: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [newValueText, setNewValueText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const usedSet = new Set(axis.valueIds);
  const available = allAttributeValues
    .filter((v) => v.attribute_id === axis.attribute.id && !usedSet.has(v.id))
    .sort((a, b) => a.display_order - b.display_order);

  const extraSet = new Set(extraValueIds ?? []);

  function handleConfirm() {
    setError(null);
    if (selected.length === 0) {
      setError("Επιλέξτε τουλάχιστον μία τιμή.");
      return;
    }
    onAddValues(selected);
    setPickerOpen(false);
    setSelected([]);
  }

  function handleCreate() {
    const raw = newValueText.trim();
    if (!raw) return;
    setError(null);
    startTransition(async () => {
      const r = await createAttributeValuesBulk({
        attributeId: axis.attribute.id,
        raw,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      // Auto-tick newly created values + any matched existing ones.
      const createdIds = r.data.created.map((av) => av.id);
      const skipped = new Set(r.data.skipped.map((v) => v.toLowerCase()));
      const existingIds = allAttributeValues
        .filter(
          (av) =>
            av.attribute_id === axis.attribute.id &&
            skipped.has(av.value.toLowerCase())
        )
        .map((av) => av.id);
      setSelected((cur) =>
        Array.from(new Set([...cur, ...createdIds, ...existingIds]))
      );
      setNewValueText("");
      // Refetch the panel bundle so the new values flow into
      // allAttributeValues and render with their real labels.
      reload();
    });
  }

  return (
    <fieldset
      className={`rounded-md ${
        staged
          ? "border-2 border-dashed border-foreground/40"
          : "border border-foreground/15"
      } bg-card p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] max-w-full`}
    >
      <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5 px-1 flex items-center gap-1.5">
        <span>{axis.attribute.name}</span>
        {staged && (
          <>
            <span className="cms-badge cms-badge-muted text-[10px]">
              σε αναμονή
            </span>
            <button
              type="button"
              onClick={onRemoveAxis}
              disabled={isPending}
              title="Αφαίρεση άξονα"
              aria-label="Αφαίρεση άξονα"
              className="ml-1 text-muted-foreground hover:text-destructive text-xs leading-none disabled:opacity-50"
            >
              ×
            </button>
          </>
        )}
      </legend>

      <div className="flex flex-wrap items-center gap-1.5">
        {axis.valueIds.map((vid) => {
          const v = valueById.get(vid);
          const isExtra = extraSet.has(vid);
          return (
            <span
              key={vid}
              className={`rounded-md border px-2 py-0.5 text-xs font-medium inline-flex items-center gap-1 ${
                isExtra
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-foreground/15 bg-muted/50"
              }`}
              title={isExtra ? "Νέα τιμή — όχι ακόμη σε παραλλαγή" : undefined}
            >
              {v?.value ?? "(?)"}
              {staged && onRemoveValue && (
                <button
                  type="button"
                  onClick={() => onRemoveValue(vid)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive text-sm leading-none disabled:opacity-50"
                  aria-label={`Αφαίρεση τιμής ${v?.value ?? vid}`}
                  title="Αφαίρεση τιμής"
                >
                  ×
                </button>
              )}
              {isExtra && !staged && onRemoveExtraValue && (
                <button
                  type="button"
                  onClick={() => onRemoveExtraValue(vid)}
                  disabled={isPending}
                  className="text-amber-700 hover:text-destructive text-sm leading-none disabled:opacity-50"
                  aria-label={`Αναίρεση προσθήκης ${v?.value ?? vid}`}
                  title="Αναίρεση προσθήκης (η τιμή δεν διαγράφεται)"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {axis.valueIds.length === 0 && (
          <span className="text-[11px] text-muted-foreground italic">
            Καμία τιμή — προσθέστε παρακάτω.
          </span>
        )}
        {!pickerOpen && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={isPending}
            className="rounded-md border border-dashed border-foreground/40 hover:border-foreground hover:bg-muted/50 px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            <span className="text-sm leading-none">+</span>
            Προσθήκη τιμών
          </button>
        )}
      </div>

      {pickerOpen && (
        <div className="mt-2.5 space-y-2 bg-muted/40 rounded p-2.5">
          {available.length > 0 ? (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">
                Επιλέξτε τιμές:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {available.map((v) => {
                  const isOn = selected.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`text-xs px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                        isOn
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background border-foreground/15 hover:border-foreground/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isOn}
                        onChange={(e) =>
                          setSelected((cur) =>
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
            <p className="text-[11px] text-muted-foreground italic">
              Όλες οι τιμές χρησιμοποιούνται — δημιουργήστε νέες.
            </p>
          )}

          <div className="pt-1.5 border-t border-foreground/10 space-y-1">
            <input
              value={newValueText}
              onChange={(e) => setNewValueText(e.target.value)}
              placeholder="Νέα τιμή… (π.χ. Πράσινο)"
              disabled={isPending}
              className="w-full px-2 py-1 text-xs rounded-sm border border-foreground/15 bg-background focus:outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground italic">
                Κόμμα για πολλαπλή προσθήκη
              </span>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isPending || !newValueText.trim()}
                className="text-[11px] font-medium rounded border border-foreground/30 hover:bg-foreground/5 px-2 py-0.5 disabled:opacity-50"
              >
                + Δημιουργία
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending || selected.length === 0}
              className="text-[11px] font-medium rounded bg-foreground text-background px-2.5 py-1 disabled:opacity-50"
            >
              Προσθήκη ({selected.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                setSelected([]);
                setNewValueText("");
                setError(null);
              }}
              className="text-[11px] font-medium rounded border border-foreground/15 hover:bg-foreground/5 px-2.5 py-1"
            >
              Άκυρο
            </button>
          </div>
        </div>
      )}

      {/* Card-split toggle — committed axes only. Pending axes don't
          have card-split meaning until they become committed. */}
      {splitState && (
        <div className="mt-2.5 pt-2 border-t border-foreground/10 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Διαχωρισμός καρτών
            </p>
            <p className="text-[10px] text-muted-foreground/80 leading-tight">
              {splitState.isSplit
                ? "Ξεχωριστή κάρτα ανά τιμή"
                : "Μία ενιαία κάρτα"}
              {splitState.isExplicitOverride && (
                <span className="italic"> · παράκαμψη</span>
              )}
            </p>
          </div>
          <Toggle
            checked={splitState.isSplit}
            onChange={splitState.onToggle}
            size="sm"
            ariaLabel="Διαχωρισμός καρτών"
          />
        </div>
      )}
    </fieldset>
  );
}

/* ── "Add new axis" tile ──────────────────────────────────────────── */

function AddAxisTile({
  attributes,
  excludeSlugs,
  onPick,
  reload,
}: {
  attributes: AttributeRow[];
  excludeSlugs: Set<string>;
  onPick: (attribute: AttributeRow) => void;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const candidates = attributes.filter((a) => !excludeSlugs.has(a.slug));

  // Create a brand-new attribute type and stage it as a pending axis.
  function createType() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const r = await createAttribute({ name });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onPick({
        id: r.data.id,
        slug: r.data.slug,
        name: r.data.name,
        splits_listing: r.data.splits_listing,
      });
      setNewName("");
      setOpen(false);
      reload(); // flow the new attribute into allAttributes
    });
  }

  function cancel() {
    setOpen(false);
    setNewName("");
    setError(null);
  }

  return (
    <fieldset className="rounded-md border-2 border-dashed border-foreground/25 bg-card p-2.5 max-w-full self-start">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-foreground/70 hover:text-foreground inline-flex items-center gap-1 px-1 py-0.5"
        >
          <span className="text-sm leading-none">+</span>
          Νέος άξονας
        </button>
      ) : (
        <div className="space-y-2 min-w-[180px]">
          {/* Pick an existing attribute type. */}
          {candidates.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                Υπάρχων τύπος
              </p>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((attr) => (
                  <button
                    key={attr.id}
                    type="button"
                    onClick={() => {
                      onPick(attr);
                      setOpen(false);
                    }}
                    disabled={isPending}
                    className="text-xs px-2 py-0.5 rounded border border-foreground/15 bg-background hover:border-foreground/40 hover:bg-muted/40 transition-colors disabled:opacity-50"
                  >
                    {attr.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Or create a brand-new attribute type inline. */}
          <div
            className={`space-y-1 ${
              candidates.length > 0 ? "pt-2 border-t border-foreground/10" : ""
            }`}
          >
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Νέος τύπος
            </p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="π.χ. Χρώμα, Μέγεθος…"
              disabled={isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createType();
                }
              }}
              className="w-full px-2 py-1 text-xs rounded-sm border border-foreground/15 bg-background focus:outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={cancel}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Άκυρο
              </button>
              <button
                type="button"
                onClick={createType}
                disabled={isPending || !newName.trim()}
                className="text-[11px] font-medium rounded border border-foreground/30 hover:bg-foreground/5 px-2 py-0.5 disabled:opacity-50"
              >
                {isPending ? "Δημιουργία…" : "+ Δημιουργία τύπου"}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
