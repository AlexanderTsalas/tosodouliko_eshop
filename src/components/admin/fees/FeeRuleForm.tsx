"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFeeRule } from "@/actions/fees";
import type { FeeCategory, FeeRule, FeeRuleScopeType } from "@/types/fee";
import {
  PAYMENT_METHODS as PM_OPTIONS,
  DELIVERY_METHODS as DM_OPTIONS,
  CARRIERS as CR_OPTIONS,
} from "@/config/storefront";

const PAYMENT_METHODS = PM_OPTIONS.map((o) => o.value);
const DELIVERY_METHODS = DM_OPTIONS.map((o) => o.value);
const CARRIERS = CR_OPTIONS.map((o) => o.value);

interface Props {
  category: FeeCategory;
  initial?: FeeRule;
  onDone?: () => void;
}

/**
 * Edit form for a single fee rule. `scope_id` for non-global scopes is a free
 * UUID input in Phase 1 — the picker UIs (category/product/variant search)
 * will come with the carrier integration phases when there's UX to attach to.
 */
export default function FeeRuleForm({ category, initial, onDone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [scopeType, setScopeType] = useState<FeeRuleScopeType>(initial?.scope_type ?? "global");
  const [scopeId, setScopeId] = useState(initial?.scope_id ?? "");
  const [rateType, setRateType] = useState<"flat" | "percentage">(initial?.rate_type ?? "flat");
  const [amount, setAmount] = useState(String(initial?.amount ?? "0"));
  const [priority, setPriority] = useState(String(initial?.priority ?? 100));
  const [combination, setCombination] = useState<"override" | "add">(
    initial?.combination ?? "override"
  );
  const [active, setActive] = useState(initial?.active ?? true);

  const [payments, setPayments] = useState<string[]>(initial?.applies_to_payment_methods ?? []);
  const [deliveries, setDeliveries] = useState<string[]>(initial?.applies_to_delivery_methods ?? []);
  const [carriers, setCarriers] = useState<string[]>(initial?.applies_to_carriers ?? []);

  function toggle(list: string[], val: string, setter: (v: string[]) => void) {
    if (list.includes(val)) setter(list.filter((x) => x !== val));
    else setter([...list, val]);
  }

  function submit() {
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Ποσό: μη έγκυρος αριθμός.");
      return;
    }
    if (scopeType !== "global" && !scopeId.trim()) {
      setError(`Για scope "${scopeType}" συμπληρώστε το ID.`);
      return;
    }
    const prio = Number(priority);
    if (!Number.isFinite(prio) || prio < 0) {
      setError("Προτεραιότητα: μη έγκυρος αριθμός.");
      return;
    }

    startTransition(async () => {
      const r = await saveFeeRule({
        id: initial?.id,
        fee_category_id: category.id,
        scope_type: scopeType,
        scope_id: scopeType === "global" ? null : scopeId.trim(),
        rate_type: rateType,
        amount: amt,
        applies_to_payment_methods:
          payments.length === 0
            ? null
            : (payments as ("stripe" | "cod" | "cash_on_pickup" | "bank_transfer")[]),
        applies_to_delivery_methods:
          deliveries.length === 0
            ? null
            : (deliveries as (
                | "home_delivery"
                | "store_pickup"
                | "delivery_station_pickup"
                | "carrier_pickup"
              )[]),
        applies_to_carriers:
          carriers.length === 0
            ? null
            : (carriers as ("acs" | "elta" | "box_now" | "speedex" | "geniki" | "other")[]),
        priority: prio,
        combination,
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
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Scope</span>
          <select
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as FeeRuleScopeType)}
            className="border rounded px-2 py-1 w-full"
          >
            <option value="global">Όλα τα προϊόντα (global)</option>
            <option value="category">Κατηγορία</option>
            <option value="product">Προϊόν</option>
            <option value="variant">Παραλλαγή</option>
          </select>
          <span className="block text-[11px] text-muted-foreground mt-1">
            Σε σύγκρουση κερδίζει το πιο συγκεκριμένο scope.
          </span>
        </label>
        {scopeType !== "global" && (
          <label>
            <span className="block text-xs text-muted-foreground mb-1">
              {scopeType === "category"
                ? "Category ID"
                : scopeType === "product"
                  ? "Product ID"
                  : "Variant ID"}
            </span>
            <input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="uuid"
              className="border rounded px-2 py-1 w-full font-mono"
            />
          </label>
        )}
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Τύπος ποσού</span>
          <select
            value={rateType}
            onChange={(e) => setRateType(e.target.value as "flat" | "percentage")}
            className="border rounded px-2 py-1 w-full"
          >
            <option value="flat">Σταθερό (€)</option>
            <option value="percentage">Ποσοστό (%)</option>
          </select>
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">
            Ποσό ({rateType === "percentage" ? "%" : "€"})
          </span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="border rounded px-2 py-1 w-full font-mono"
          />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Προτεραιότητα</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="border rounded px-2 py-1 w-full font-mono"
          />
          <span className="block text-[11px] text-muted-foreground mt-1">
            Μικρότερος αριθμός κερδίζει μέσα στο ίδιο scope.
          </span>
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Σύνθεση</span>
          <select
            value={combination}
            onChange={(e) => setCombination(e.target.value as "override" | "add")}
            className="border rounded px-2 py-1 w-full"
          >
            <option value="override">Αντικαθιστά</option>
            <option value="add">Προστίθεται</option>
          </select>
          <span className="block text-[11px] text-muted-foreground mt-1">
            <code>add</code> στρώνεται πάνω στον επιλεγμένο κανόνα override.
          </span>
        </label>
        <label className="flex items-end gap-2 pb-1">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span className="text-xs">Ενεργός</span>
        </label>
      </div>

      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-xs text-muted-foreground px-1">
          Εφαρμόζεται μόνο όταν (κενό = ισχύει πάντα)
        </legend>
        <div className="space-y-2">
          <div>
            <span className="block text-xs text-muted-foreground mb-1">Μέθοδοι πληρωμής</span>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((v) => (
                <label key={v} className="text-xs flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={payments.includes(v)}
                    onChange={() => toggle(payments, v, setPayments)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground mb-1">Τρόποι παράδοσης</span>
            <div className="flex flex-wrap gap-2">
              {DELIVERY_METHODS.map((v) => (
                <label key={v} className="text-xs flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={deliveries.includes(v)}
                    onChange={() => toggle(deliveries, v, setDeliveries)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground mb-1">Couriers</span>
            <div className="flex flex-wrap gap-2">
              {CARRIERS.map((v) => (
                <label key={v} className="text-xs flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={carriers.includes(v)}
                    onChange={() => toggle(carriers, v, setCarriers)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
        </div>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {isPending ? "Αποθήκευση..." : initial ? "Αποθήκευση" : "Δημιουργία"}
        </button>
      </div>
    </div>
  );
}
