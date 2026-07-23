"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FeeCategoryForm from "./FeeCategoryForm";
import FeeRulesList from "./FeeRulesList";
import { deleteFeeCategory } from "@/actions/fees";
import { Pencil } from "@/components/admin/common/icons";
import type { FeeCategory, FeeRule } from "@/types/fee";

const PERCENT_BASE_LABELS: Record<string, string> = {
  order_subtotal: "% επί υποσυνόλου",
  subtotal_plus_shipping: "% επί (υποσυνόλου + μεταφορικά)",
  cod_amount: "% επί ποσού αντικαταβολής",
  fixed_amount: "Σταθερό ποσό",
};

const APPLIES_KEY_LABELS: Record<string, string> = {
  payment_method: "Πληρωμή",
  delivery_method: "Παράδοση",
  carrier: "Courier",
  min_subtotal: "Ελάχ. υποσύνολο",
  max_subtotal: "Μέγ. υποσύνολο",
};

interface Props {
  category: FeeCategory;
  rules: FeeRule[];
}

/**
 * Collapsible card per fee category. The whole card acts as one
 * collapsible panel — clicking the header toggles the body, which
 * contains the meta summary, the rules list, and (when explicitly
 * requested) the edit form. The previous design had nested fieldsets +
 * inline edit toggles which became visually busy at multiple
 * categories on screen.
 */
export default function FeeCategoryCard({ category, rules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (category.is_system) return;
    setError(null);
    if (
      !confirm(
        `Διαγραφή κατηγορίας "${category.label}";\n\n` +
          `Θα διαγραφούν και οι ${rules.length} κανόνες κάτω από αυτήν.`
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteFeeCategory({ id: category.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const appliesEntries = Object.entries(category.applies_when ?? {});

  return (
    <section
      className={`border border-foreground/15 rounded-lg overflow-hidden bg-card transition-colors ${
        !category.active ? "opacity-60" : ""
      }`}
    >
      {/* Header: collapse trigger + identity badges + actions. The
          actions (edit / delete) stopPropagation so clicks on them
          don't accidentally toggle the panel. */}
      <header
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Chevron open={open} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold tracking-tight">{category.label}</h2>
              <code className="text-xs font-mono text-muted-foreground">
                {category.slug}
              </code>
              {category.is_system && (
                <span className="cms-badge cms-badge-muted">system</span>
              )}
              {!category.active && (
                <span className="cms-badge cms-badge-muted">ανενεργή</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {rules.length}{" "}
              {rules.length === 1 ? "κανόνας" : "κανόνες"} ·{" "}
              {PERCENT_BASE_LABELS[category.percentage_base] ??
                category.percentage_base}
              {category.pricing_source === "api" && " · από courier API"}
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setEditing((v) => !v);
            }}
            className="btn btn-secondary btn-sm"
          >
            {editing ? (
              "Κλείσιμο"
            ) : (
              <>
                <Pencil className="w-3.5 h-3.5" />
                Επεξεργασία
              </>
            )}
          </button>
          {!category.is_system && (
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              className="btn btn-destructive btn-sm"
              aria-label="Διαγραφή"
              title="Διαγραφή κατηγορίας"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/5 border-y border-destructive/30 px-4 py-2"
        >
          {error}
        </p>
      )}

      {/* Body — always rendered so the cms-accordion can animate
          smoothly between collapsed and expanded states. The
          cms-accordion utility class handles 0fr → 1fr grid-rows
          interpolation. */}
      <div className={`cms-accordion ${open ? "is-open" : ""}`}>
        <div className="border-t border-foreground/10 p-4 space-y-5">
          {editing && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
                Επεξεργασία κατηγορίας
              </h3>
              <FeeCategoryForm
                initial={category}
                onDone={() => setEditing(false)}
              />
            </div>
          )}

          {/* Meta summary — when the user isn't editing, surface the
              category's "applies_when" filters so they're scannable
              without opening the form. */}
          {!editing &&
            (category.description || appliesEntries.length > 0) && (
              <div className="text-sm space-y-2">
                {category.description && (
                  <p className="text-muted-foreground">{category.description}</p>
                )}
                {appliesEntries.length > 0 && (
                  <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-xs">
                    <span className="text-muted-foreground font-medium">
                      Εφαρμόζεται όταν:
                    </span>
                    {appliesEntries.map(([k, v]) => (
                      <span
                        key={k}
                        className="cms-badge cms-badge-muted"
                      >
                        {APPLIES_KEY_LABELS[k] ?? k}:{" "}
                        {typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

          <FeeRulesList category={category} rules={rules} />
        </div>
      </div>
    </section>
  );
}

/**
 * Chevron icon for the collapsible header. Rotates 90° when open. Same
 * shape vocabulary as the sidebar so the visual language of
 * "collapsible thing" is consistent across the admin.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 180ms ease",
        flexShrink: 0,
        color: "hsl(var(--foreground) / 0.55)",
      }}
    >
      <path
        d="M5 3.5 L9 7 L5 10.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
