"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFeeCategory } from "@/actions/fees";
import type { FeeCategory, FeeAppliesWhen } from "@/types/fee";
import {
  PAYMENT_METHODS,
  DELIVERY_METHODS,
  CARRIERS,
} from "@/config/storefront";

const PERCENTAGE_BASES = [
  { v: "order_subtotal", label: "Υποσύνολο παραγγελίας" },
  { v: "subtotal_plus_shipping", label: "Υποσύνολο + μεταφορικά" },
  { v: "cod_amount", label: "Ποσό αντικαταβολής" },
  { v: "fixed_amount", label: "Σταθερό ποσό (δεν χρησιμοποιείται %)" },
] as const;


interface Props {
  initial?: FeeCategory;
  onDone?: () => void;
}

/**
 * Edit form for a fee category. Slug is creatable but immutable post-create
 * (integration code references categories by slug, so renaming would break
 * the audit + carrier integration mappings).
 */
export default function FeeCategoryForm({ initial, onDone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial;
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [displayOrder, setDisplayOrder] = useState(String(initial?.display_order ?? 100));
  const [percentageBase, setPercentageBase] = useState(initial?.percentage_base ?? "order_subtotal");
  const [pricingSource, setPricingSource] = useState(initial?.pricing_source ?? "custom");
  const [active, setActive] = useState(initial?.active ?? true);

  // applies_when
  const aw: FeeAppliesWhen = initial?.applies_when ?? {};
  const [paymentMethod, setPaymentMethod] = useState<string>(aw.payment_method ?? "");
  const [deliveryMethod, setDeliveryMethod] = useState<string>(aw.delivery_method ?? "");
  const [carrier, setCarrier] = useState<string>(aw.carrier ?? "");
  const [minSubtotal, setMinSubtotal] = useState(
    typeof aw.min_subtotal === "number" ? String(aw.min_subtotal) : ""
  );
  const [maxSubtotal, setMaxSubtotal] = useState(
    typeof aw.max_subtotal === "number" ? String(aw.max_subtotal) : ""
  );

  function submit() {
    setError(null);
    if (!label.trim()) {
      setError("Συμπληρώστε το όνομα.");
      return;
    }
    if (!isEdit && !slug.trim()) {
      setError("Το slug είναι υποχρεωτικό σε νέα κατηγορία.");
      return;
    }

    const applies_when: FeeAppliesWhen = {};
    if (paymentMethod) applies_when.payment_method = paymentMethod as FeeAppliesWhen["payment_method"];
    if (deliveryMethod) applies_when.delivery_method = deliveryMethod as FeeAppliesWhen["delivery_method"];
    if (carrier) applies_when.carrier = carrier as FeeAppliesWhen["carrier"];
    if (minSubtotal.trim()) {
      const n = Number(minSubtotal);
      if (!Number.isFinite(n) || n < 0) {
        setError("Ελάχ. υποσύνολο: μη έγκυρος αριθμός.");
        return;
      }
      applies_when.min_subtotal = n;
    }
    if (maxSubtotal.trim()) {
      const n = Number(maxSubtotal);
      if (!Number.isFinite(n) || n < 0) {
        setError("Μέγ. υποσύνολο: μη έγκυρος αριθμός.");
        return;
      }
      applies_when.max_subtotal = n;
    }

    const display_order_num = Number(displayOrder);
    if (!Number.isFinite(display_order_num) || display_order_num < 0) {
      setError("Σειρά: μη έγκυρος αριθμός.");
      return;
    }

    startTransition(async () => {
      const r = await saveFeeCategory({
        id: initial?.id,
        slug: isEdit ? undefined : slug.trim(),
        label: label.trim(),
        description: description.trim() || null,
        applies_when,
        display_order: display_order_num,
        percentage_base: percentageBase,
        pricing_source: pricingSource,
        active,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Slug{" "}
            {isEdit && (
              <span className="text-xs text-muted-foreground font-normal">
                (δεν αλλάζει)
              </span>
            )}
          </span>
          <input
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
            }
            disabled={isEdit}
            placeholder="service_fee"
            className="cms-input font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">Ετικέτα</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Χρέωση εξυπηρέτησης"
            className="cms-input"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-sm font-medium mb-1.5">
            Περιγραφή{" "}
            <span className="text-xs text-muted-foreground font-normal">
              (προαιρετικό)
            </span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="cms-input"
            style={{ height: "auto", minHeight: "4.5rem" }}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Σειρά εμφάνισης
          </span>
          <input
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="cms-input font-mono"
          />
          <span className="block text-xs text-muted-foreground mt-1">
            Μικρότερος αριθμός = υπολογίζεται και εμφανίζεται πρώτο.
          </span>
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">Βάση ποσοστού</span>
          <select
            value={percentageBase}
            onChange={(e) =>
              setPercentageBase(e.target.value as FeeCategory["percentage_base"])
            }
            className="cms-input"
          >
            {PERCENTAGE_BASES.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Πηγή τιμολόγησης
          </span>
          <select
            value={pricingSource}
            onChange={(e) =>
              setPricingSource(e.target.value as FeeCategory["pricing_source"])
            }
            className="cms-input"
          >
            <option value="custom">Custom κανόνες</option>
            <option value="api">Courier API</option>
          </select>
          <span className="block text-xs text-muted-foreground mt-1">
            Το <code className="font-mono">api</code> ενεργοποιείται όταν στηθεί
            πάροχος (Phase 2+). Προς το παρόν χρησιμοποιείται μόνο το{" "}
            <code className="font-mono">custom</code>.
          </span>
        </label>
        <label className="md:col-span-2 flex items-start gap-3 rounded-md border border-foreground/15 bg-muted/20 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium">Ενεργή κατηγορία</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Απενεργοποιήστε για να εξαιρέσετε όλους τους κανόνες αυτής της
              κατηγορίας από τον υπολογισμό.
            </p>
          </div>
        </label>
      </div>

      <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
        <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">
          Εφαρμόζεται όταν · όλα τα κριτήρια πρέπει να ισχύουν
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">
              Μέθοδος πληρωμής
            </span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="cms-input"
            >
              <option value="">(όλες)</option>
              {PAYMENT_METHODS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">
              Τρόπος παράδοσης
            </span>
            <select
              value={deliveryMethod}
              onChange={(e) => setDeliveryMethod(e.target.value)}
              className="cms-input"
            >
              <option value="">(όλοι)</option>
              {DELIVERY_METHODS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Courier</span>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="cms-input"
            >
              <option value="">(όλοι)</option>
              {CARRIERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-sm font-medium mb-1.5">
                Ελάχ. υποσύνολο
              </span>
              <input
                type="number"
                step="0.01"
                value={minSubtotal}
                onChange={(e) => setMinSubtotal(e.target.value)}
                placeholder="—"
                className="cms-input font-mono"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1.5">
                Μέγ. υποσύνολο
              </span>
              <input
                type="number"
                step="0.01"
                value={maxSubtotal}
                onChange={(e) => setMaxSubtotal(e.target.value)}
                placeholder="—"
                className="cms-input font-mono"
              />
            </label>
          </div>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-center gap-2 pt-3 border-t border-foreground/10">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="btn btn-primary btn-md"
        >
          {isPending
            ? "Αποθήκευση..."
            : isEdit
              ? "Αποθήκευση αλλαγών"
              : "Δημιουργία"}
        </button>
      </div>
    </div>
  );
}
