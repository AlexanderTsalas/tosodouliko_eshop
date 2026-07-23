"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CustomDeliveryMethodForm, {
  type CustomDeliveryMethodInitial,
} from "./CustomDeliveryMethodForm";
import { toggleCustomDeliveryMethodActive } from "@/actions/courier-settings/toggleCustomDeliveryMethodActive";
import { deleteCustomDeliveryMethod } from "@/actions/courier-settings/deleteCustomDeliveryMethod";
import Toggle from "@/components/admin/common/Toggle";
import { Pencil } from "@/components/admin/common/icons";
import { DELIVERY_METHODS, type DeliveryMethodValue } from "@/config/storefront";

export interface CustomDeliveryMethodRow {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  base_method: DeliveryMethodValue;
  carrier_slug: string | null;
  is_active: boolean;
  display_order: number;
}

interface CarrierOption {
  slug: string;
  display_name: string;
  is_active: boolean;
}

interface Props {
  methods: CustomDeliveryMethodRow[];
  carriers: CarrierOption[];
}

const BASE_METHOD_LABELS: Record<DeliveryMethodValue, string> = Object.fromEntries(
  DELIVERY_METHODS.map((m) => [m.value, m.label])
) as Record<DeliveryMethodValue, string>;

/**
 * Admin section listing every custom delivery method with per-row
 * visibility toggle, edit, delete. Mirrors the DeliveryCarriersSection
 * pattern so admin muscle memory carries over.
 */
export default function CustomDeliveryMethodsSection({
  methods,
  carriers,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const carrierLookup = new Map(carriers.map((c) => [c.slug, c]));

  function handleToggle(row: CustomDeliveryMethodRow) {
    setError(null);
    setPendingSlug(row.slug);
    startTransition(async () => {
      const res = await toggleCustomDeliveryMethodActive({
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

  function handleDelete(row: CustomDeliveryMethodRow) {
    if (confirmingDelete !== row.slug) {
      setConfirmingDelete(row.slug);
      return;
    }
    setError(null);
    setPendingSlug(row.slug);
    startTransition(async () => {
      const res = await deleteCustomDeliveryMethod({ slug: row.slug });
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
          <h2 className="text-lg font-semibold">Custom τρόποι παράδοσης</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Δημιουργήστε δικούς σας τρόπους παράδοσης (π.χ. «Παράδοση με Van»)
            με όνομα, περιγραφή και προαιρετική σύνδεση με συγκεκριμένη
            μεταφορική. Εμφανίζονται στο checkout δίπλα στους built-in
            τρόπους.
          </p>
        </div>
        {!creating && !editing && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border px-3 py-1.5 text-sm whitespace-nowrap"
          >
            + Νέος τρόπος παράδοσης
          </button>
        )}
      </header>

      {creating && (
        <div className="border rounded p-3 mb-4 bg-muted/30">
          <h3 className="text-sm font-medium mb-2">Νέος τρόπος παράδοσης</h3>
          <CustomDeliveryMethodForm
            carriers={carriers}
            onSaved={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive mb-3">{error}</p>
      )}

      {methods.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Δεν έχετε δημιουργήσει custom τρόπους παράδοσης ακόμη.
        </p>
      ) : (
        <ul className="divide-y">
          {methods.map((row) => {
            const isEditingThis = editing === row.slug;
            const isPendingThis = pendingSlug === row.slug && isPending;
            const scopedCarrier = row.carrier_slug
              ? carrierLookup.get(row.carrier_slug) ?? null
              : null;
            const initial: CustomDeliveryMethodInitial = {
              slug: row.slug,
              display_name: row.display_name,
              description: row.description,
              base_method: row.base_method,
              carrier_slug: row.carrier_slug,
            };
            return (
              <li key={row.id} className="py-3">
                <div className="flex items-start gap-4">
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
                      className={`font-semibold tracking-tight ${
                        !row.is_active ? "text-muted-foreground" : ""
                      }`}
                    >
                      {row.display_name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Τύπος: {BASE_METHOD_LABELS[row.base_method] ?? row.base_method}
                      {" · "}
                      {scopedCarrier ? (
                        <>
                          Μεταφορική: {scopedCarrier.display_name}
                          {!scopedCarrier.is_active && (
                            <span className="italic"> (ανενεργή)</span>
                          )}
                        </>
                      ) : (
                        <>Οποιαδήποτε συμβατή μεταφορική</>
                      )}
                    </p>
                    {row.description && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        «{row.description}»
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
                  </div>
                </div>

                {isEditingThis && (
                  <div className="mt-3 border-t pt-3">
                    <CustomDeliveryMethodForm
                      initial={initial}
                      carriers={carriers}
                      onSaved={() => setEditing(null)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
