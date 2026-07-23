"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import DeliveryCarrierForm from "./DeliveryCarrierForm";
import { toggleCarrierActive } from "@/actions/courier-settings/toggleCarrierActive";
import Toggle from "@/components/admin/common/Toggle";
import { Pencil } from "@/components/admin/common/icons";
import { deleteCustomCarrier } from "@/actions/courier-settings/deleteCustomCarrier";
import type { DeliveryMethodValue } from "@/config/storefront";
import { DELIVERY_METHODS } from "@/config/storefront";

type TimelinePreset = "generic" | "acs_style" | "geniki_style" | "boxnow_style";

export interface DeliveryCarrierRow {
  id: string;
  slug: string;
  display_name: string;
  supported_delivery_methods: DeliveryMethodValue[];
  display_order: number;
  is_active: boolean;
  is_custom: boolean;
  tracking_url_template: string | null;
  timeline_preset: TimelinePreset | null;
}

interface Props {
  carriers: DeliveryCarrierRow[];
}

const DELIVERY_METHOD_LABELS: Record<DeliveryMethodValue, string> = Object.fromEntries(
  DELIVERY_METHODS.map((m) => [m.value, m.label])
) as Record<DeliveryMethodValue, string>;

/**
 * Phase 9 — admin section listing every carrier in delivery_carriers with
 * per-row visibility toggle, edit, delete (custom only). Sits above the
 * carrier_provider_configs section: that one configures credentials for
 * carriers with API integrations; this one decides which carriers (built-in
 * or custom) show up at all.
 *
 * Hides the "Νέα custom μεταφορική" panel behind an explicit "+ Νέα" button
 * — most admins won't ever create one, so collapsing reduces visual noise.
 *
 * Delete confirmation is inline (two-click pattern); a destructive action
 * with a hard-to-reverse blast radius warrants the friction. Built-ins
 * don't render a delete button at all.
 */
export default function DeliveryCarriersSection({ carriers }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle(row: DeliveryCarrierRow) {
    setError(null);
    setPendingSlug(row.slug);
    startTransition(async () => {
      const res = await toggleCarrierActive({
        slug: row.slug,
        is_active: !row.is_active,
      });
      setPendingSlug(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(row: DeliveryCarrierRow) {
    if (confirmingDelete !== row.slug) {
      setConfirmingDelete(row.slug);
      return;
    }
    setError(null);
    setPendingSlug(row.slug);
    startTransition(async () => {
      const res = await deleteCustomCarrier({ slug: row.slug });
      setPendingSlug(null);
      setConfirmingDelete(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="border rounded p-4 mb-6">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Διαθέσιμες μεταφορικές</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Ενεργοποιήστε ή απενεργοποιήστε μεταφορικές. Μόνο οι ενεργές
            εμφανίζονται στο checkout. Προσθέστε Custom Μεταφορικές αν θέλετε
            να δώσετε στους Πελάτες σας επιπλέον επιλογές ή κάποια δική σας
            επιλογή Μεταφοράς (πχ Μεταφορά με Van)
          </p>
        </div>
        {!creating && !editing && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border px-3 py-1.5 text-sm"
          >
            + Νέα custom μεταφορική
          </button>
        )}
      </header>

      {creating && (
        <div className="border rounded p-3 mb-4 bg-muted/30">
          <h3 className="text-sm font-medium mb-2">Νέα custom μεταφορική</h3>
          <DeliveryCarrierForm
            onSaved={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive mb-3">{error}</p>
      )}

      {carriers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Δεν έχουν δημιουργηθεί μεταφορικές.
        </p>
      ) : (
        <ul className="divide-y">
          {carriers.map((row) => {
            const isEditingThis = editing === row.slug;
            const isPendingThis = pendingSlug === row.slug && isPending;
            return (
              <li key={row.id} className="py-3">
                <div className="flex items-start gap-4">
                  {/* Toggle pinned to the LEFT — the on/off switch is
                      the primary control for each carrier, so it leads
                      the row visually. */}
                  <div className="pt-1 shrink-0">
                    <Toggle
                      checked={row.is_active}
                      onChange={() => handleToggle(row)}
                      size="sm"
                      ariaLabel={`${
                        row.is_active ? "Απενεργοποίηση" : "Ενεργοποίηση"
                      } ${row.display_name}`}
                      title={
                        row.is_active
                          ? `Απενεργοποίηση ${row.display_name}`
                          : `Ενεργοποίηση ${row.display_name}`
                      }
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-semibold tracking-tight flex items-center gap-2 flex-wrap ${
                        !row.is_active ? "text-muted-foreground" : ""
                      }`}
                    >
                      <span>{row.display_name}</span>
                      {row.is_custom ? (
                        <span className="cms-badge cms-badge-muted">Custom</span>
                      ) : (
                        <span className="cms-badge cms-badge-muted">Built-in</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Τρόποι:{" "}
                      {row.supported_delivery_methods
                        .map((m) => DELIVERY_METHOD_LABELS[m] ?? m)
                        .join(" · ")}
                    </p>
                    {row.tracking_url_template && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        Tracking:{" "}
                        <span className="font-mono">{row.tracking_url_template}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(isEditingThis ? null : row.slug);
                        setCreating(false);
                        setConfirmingDelete(null);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      {isEditingThis ? (
                        "Κλείσιμο"
                      ) : (
                        <>
                          <Pencil className="w-3.5 h-3.5" />
                          Επεξεργασία
                        </>
                      )}
                    </button>
                    {row.is_custom && (
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={isPendingThis}
                        className={`text-xs underline disabled:opacity-50 ${
                          confirmingDelete === row.slug
                            ? "text-destructive font-medium"
                            : "text-destructive/80"
                        }`}
                      >
                        {confirmingDelete === row.slug
                          ? "Επιβεβαίωση διαγραφής"
                          : "Διαγραφή"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Edit form animates open via the global
                    cms-accordion utility — same expansion pattern as
                    the sidebar and FeeCategoryCard. Always rendered
                    so the transition has both sides to interpolate
                    between. */}
                <div className={`cms-accordion ${isEditingThis ? "is-open" : ""}`}>
                  <div className="mt-3 border-t pt-3">
                    <DeliveryCarrierForm
                      initial={{
                        slug: row.slug,
                        display_name: row.display_name,
                        supported_delivery_methods: row.supported_delivery_methods,
                        tracking_url_template: row.tracking_url_template,
                        timeline_preset: row.timeline_preset,
                        is_custom: row.is_custom,
                        is_active: row.is_active,
                      }}
                      onSaved={() => setEditing(null)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
