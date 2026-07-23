"use client";

import { useState, useTransition } from "react";
import { updateProduct } from "@/actions/products/updateProduct";
import Toggle from "@/components/admin/common/Toggle";
import { Split as SplitIcon } from "@/components/admin/common/icons";
import type { Attribute } from "@/types/attribute-facets";
import type { ProductVariant } from "@/types/product-variants";

interface CommonProps {
  attributes: Attribute[];
  /**
   * Variants used to figure out which attributes actually drive
   * variant axes (only those get a toggle row). In create mode,
   * variants haven't been persisted yet — pass the staged variants
   * (built from the in-progress axis combos) so the toggle list
   * stays correct as the admin adds/removes axes.
   */
  variants: ProductVariant[];
  initialOverrides: Record<string, boolean> | null;
}

interface EditProps extends CommonProps {
  mode?: "edit";
  productId: string;
}

interface CreateProps extends CommonProps {
  mode: "create";
  /** Fires whenever the override map changes. Parent (ProductCreateClient)
   *  buffers the latest snapshot and submits it to createProduct on
   *  final save — no per-toggle server call. */
  onOverridesChange: (overrides: Record<string, boolean>) => void;
}

type Props = EditProps | CreateProps;

/**
 * Per-product override of attributes.splits_listing — controls whether
 * the storefront catalog renders variants of the same product as ONE
 * combined card (split=off) or as SEPARATE cards per attribute value
 * (split=on, e.g. each colour gets its own card in the grid).
 *
 * UX: one squared container per attribute showing the CURRENT visual
 * effect of the toggle:
 *   - Toggle OFF → preview shows ONE card outline ("one card in the
 *     catalog, customer picks the variant on the detail page")
 *   - Toggle ON  → preview shows TWO overlapping card outlines
 *     ("multiple cards in the catalog, one per attribute value")
 *
 * The toggle is binary in the UI but maps to a tri-state in the data:
 *   - Toggle reflects the EFFECTIVE behavior (global default OR override)
 *   - Click OFF → write explicit false override
 *   - Click ON  → write explicit true override
 * The "use global default" case is reachable but rare; admins who want
 * to revert can simply set the override to match the global flag and
 * the next save clears it. We keep the override matrix this simple
 * because tri-state confused admins in earlier iterations.
 *
 * Modes:
 *   - "edit" (default): on save click, calls updateProduct with the
 *     full override map. Shows save button + status feedback.
 *   - "create": no save button; every toggle change emits via
 *     `onOverridesChange` so the parent's atomic createProduct call
 *     can include the override map in the same transaction as the
 *     product row.
 */
export default function SplitOverridesPanel(props: Props) {
  const isCreate = props.mode === "create";
  const [overrides, setOverrides] = useState<Record<string, boolean>>(
    props.initialOverrides ?? {}
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Restrict the list to attributes that actually appear in this product's variants —
  // toggling split on an attribute that's not part of the variant axes is meaningless.
  const usedSlugs = new Set<string>();
  for (const v of props.variants) {
    if (!v.attribute_combo) continue;
    for (const slug of Object.keys(v.attribute_combo)) usedSlugs.add(slug);
  }
  const relevant = props.attributes.filter((a) => usedSlugs.has(a.slug));

  /**
   * Resolve the effective split state for an attribute: explicit
   * override wins; otherwise fall back to the global splits_listing
   * flag on the attribute itself.
   */
  function isSplit(attr: Attribute): boolean {
    if (attr.slug in overrides) return overrides[attr.slug];
    return attr.splits_listing;
  }

  /**
   * Toggle handler. Always writes an explicit override (the simpler
   * binary UX from the user's perspective). If the new state matches
   * the global default, we still store the explicit value — it's
   * functionally equivalent and avoids the tri-state ambiguity.
   *
   * Create mode emits the override map to the parent so the atomic
   * createProduct call carries the latest state on submit.
   */
  function setSplit(attr: Attribute, next: boolean) {
    setSaved(false);
    // Compute updated state outside the setOverrides updater so we
    // don't call the parent's setState inside React's render path.
    // Calling onOverridesChange from within `setOverrides((cur) => ...)`
    // triggers React 19's "Cannot update a component while rendering
    // a different component" guard.
    const updated = { ...overrides, [attr.slug]: next };
    setOverrides(updated);
    if (isCreate) {
      (props as CreateProps).onOverridesChange(updated);
    }
  }

  function handleSave() {
    if (isCreate) return; // shouldn't happen — button hidden in create
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await updateProduct({
        id: (props as EditProps).productId,
        splitOverrides: overrides,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSaved(true);
    });
  }

  if (relevant.length === 0) {
    return (
      <section className="cms-card-section">
        <header className="pb-3 -mt-1 mb-3 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <SplitIcon className="w-4 h-4" />
            Διαχωρισμός καρτών
          </h2>
        </header>
        <p className="text-sm text-foreground/70">
          {isCreate
            ? "Προσθέστε άξονες παραλλαγών παραπάνω για να εμφανιστούν εδώ οι επιλογές διαχωρισμού καρτών."
            : "Δεν υπάρχουν χαρακτηριστικά στις παραλλαγές για να ρυθμίσετε εδώ. Προσθέστε άξονες παραλλαγών για να εμφανιστούν επιλογές."}
        </p>
      </section>
    );
  }

  return (
    <section className="cms-card-section space-y-5">
      <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
        <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
          <SplitIcon className="w-4 h-4" />
          Διαχωρισμός καρτών στον κατάλογο
        </h2>
        <p className="text-sm text-foreground/70 mt-1.5">
          Για κάθε χαρακτηριστικό παραλλαγής επιλέξτε αν στον κατάλογο θα
          εμφανίζεται μία ενιαία κάρτα (off) ή ξεχωριστή κάρτα ανά τιμή του
          χαρακτηριστικού (on, π.χ. ένα προϊόν για κάθε χρώμα).
        </p>
      </header>

      {/* Compact tile per attribute — visual preview on the left,
          name/toggle on the right. Sits inline as wide as needed; the
          grid wraps to multiple columns on bigger screens. Sized to
          fit ~3-4 across on a typical admin viewport. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {relevant.map((attr) => {
          const split = isSplit(attr);
          const explicitOverride = attr.slug in overrides;
          return (
            <article
              key={attr.id}
              className={`rounded-lg border bg-card transition-all flex items-center gap-3 p-3 ${
                split
                  ? "border-foreground/40 shadow-sm"
                  : "border-foreground/15"
              }`}
            >
              {/* Visual preview — small, fixed-size, on the left. */}
              <div className="shrink-0">
                <SplitPreview split={split} />
              </div>

              {/* Name + state on the right, toggle pinned at far right. */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold tracking-tight truncate">
                  {attr.name}
                </p>
                <p className="text-[11px] text-muted-foreground leading-tight">
                  {split ? "Ξεχωριστή κάρτα" : "Ενιαία κάρτα"}
                  {explicitOverride && (
                    <span className="italic"> · παράκαμψη</span>
                  )}
                </p>
              </div>

              <Toggle
                checked={split}
                onChange={(next) => setSplit(attr, next)}
                size="sm"
                ariaLabel={`Διαχωρισμός κατά ${attr.name}`}
              />
            </article>
          );
        })}
      </div>

      {/* Save button: edit mode only. In create mode the parent's
          atomic submit picks up the overrides via onOverridesChange. */}
      {!isCreate && (
        <div className="flex items-center gap-3 pt-2 border-t border-foreground/10">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="btn btn-primary btn-md"
          >
            {isPending ? "Αποθήκευση..." : "Αποθήκευση"}
          </button>
          {saved && (
            <span className="text-xs text-emerald-600">Αποθηκεύτηκε.</span>
          )}
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * SVG preview communicating the split state visually:
 *   - split=false → one card outline (means one card in the catalog)
 *   - split=true  → two overlapping card outlines, offset diagonally
 *     (means multiple cards, one per value)
 *
 * Drawn with currentColor so the preview adapts to the surrounding
 * text colour automatically — bordered tile is muted; the SVG sits at
 * ~50% alpha to keep it secondary to the toggle CTA.
 */
function SplitPreview({ split }: { split: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="w-12 h-12 text-foreground/60"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {split ? (
        <>
          {/* Back card — slightly muted */}
          <g opacity={0.45}>
            <rect x="18" y="10" width="56" height="74" rx="6" />
            <line x1="26" y1="62" x2="58" y2="62" />
            <line x1="26" y1="70" x2="48" y2="70" />
          </g>
          {/* Front card — primary, offset diagonally */}
          <rect x="28" y="20" width="56" height="74" rx="6" fill="hsl(var(--background))" />
          <line x1="36" y1="72" x2="68" y2="72" />
          <line x1="36" y1="80" x2="58" y2="80" />
        </>
      ) : (
        <>
          {/* Single card */}
          <rect x="23" y="14" width="54" height="72" rx="6" />
          <line x1="31" y1="68" x2="63" y2="68" />
          <line x1="31" y1="76" x2="55" y2="76" />
        </>
      )}
    </svg>
  );
}
