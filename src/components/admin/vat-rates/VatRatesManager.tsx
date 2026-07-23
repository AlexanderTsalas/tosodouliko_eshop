"use client";

import { useState, useTransition } from "react";
import { createVatRate } from "@/actions/vat-rates/createVatRate";
import { updateVatRate } from "@/actions/vat-rates/updateVatRate";
import { deleteVatRate } from "@/actions/vat-rates/deleteVatRate";
import type { VatRate } from "@/types/vat-rates";

interface Props {
  initial: VatRate[];
}

/**
 * VAT rates manager. Two panels:
 *
 *   - Top: "Νέα κατηγορία" form in a single tidy row (name, code, rate%, default).
 *   - Bottom: existing rates as a sortable cms-table. Each row's name + rate%
 *     are inline-editable; default-state toggles via button or shows as a
 *     non-clickable pill if already default.
 *
 * Default-row protection: the active default can't be deleted. Setting a
 * different row as default first releases it.
 */
export default function VatRatesManager({ initial }: Props) {
  const [rates, setRates] = useState<VatRate[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "").trim();
    const code = String(formData.get("code") ?? "").trim().toUpperCase();
    const ratePct = Number(formData.get("ratePct") ?? 0);
    const isDefault = formData.get("isDefault") === "on";
    if (!name || !code || !Number.isFinite(ratePct)) return;
    startTransition(async () => {
      const r = await createVatRate({
        name,
        code,
        rate: ratePct / 100,
        isDefault,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setRates((cur) => {
        const next = isDefault
          ? cur.map((x) => ({ ...x, is_default: false }))
          : cur.slice();
        return [...next, r.data];
      });
    });
  }

  function handleUpdateName(rate: VatRate, name: string) {
    if (name === rate.name || !name.trim()) return;
    setRates((cur) =>
      cur.map((r) => (r.id === rate.id ? { ...r, name } : r))
    );
    startTransition(async () => {
      const r = await updateVatRate({ id: rate.id, name });
      if (!r.success) {
        setError(r.error);
        setRates((cur) =>
          cur.map((x) => (x.id === rate.id ? { ...x, name: rate.name } : x))
        );
      }
    });
  }

  function handleUpdateRate(rate: VatRate, ratePct: number) {
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct >= 100) return;
    const newRate = ratePct / 100;
    if (newRate === rate.rate) return;
    setRates((cur) =>
      cur.map((r) => (r.id === rate.id ? { ...r, rate: newRate } : r))
    );
    startTransition(async () => {
      const r = await updateVatRate({ id: rate.id, rate: newRate });
      if (!r.success) {
        setError(r.error);
        setRates((cur) =>
          cur.map((x) => (x.id === rate.id ? { ...x, rate: rate.rate } : x))
        );
      }
    });
  }

  function handleMakeDefault(rate: VatRate) {
    if (rate.is_default) return;
    setRates((cur) =>
      cur.map((r) => ({ ...r, is_default: r.id === rate.id }))
    );
    startTransition(async () => {
      const r = await updateVatRate({ id: rate.id, isDefault: true });
      if (!r.success) {
        setError(r.error);
        setRates((cur) =>
          cur.map((x) => ({
            ...x,
            is_default:
              x.id === rate.id
                ? rate.is_default
                : initial.find((i) => i.id === x.id)?.is_default ?? false,
          }))
        );
      }
    });
  }

  function handleDelete(rate: VatRate) {
    if (rate.is_default) {
      setError(
        "Δεν επιτρέπεται η διαγραφή της προεπιλεγμένης κατηγορίας. Ορίστε άλλη ως προεπιλογή πρώτα."
      );
      return;
    }
    if (!confirm(`Διαγραφή κατηγορίας ΦΠΑ «${rate.name}»;`)) return;
    const prev = rates;
    setRates((cur) => cur.filter((r) => r.id !== rate.id));
    startTransition(async () => {
      const r = await deleteVatRate({ id: rate.id });
      if (!r.success) {
        setError(r.error);
        setRates(prev);
      }
    });
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* New category form */}
      <section className="cms-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Νέα κατηγορία
        </h2>
        <form
          action={handleCreate}
          className="grid grid-cols-1 sm:grid-cols-[1fr_180px_120px_auto_auto] gap-3 items-end"
        >
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Όνομα</span>
            <input
              name="name"
              required
              placeholder="π.χ. Μειωμένος νησιών"
              className="cms-input"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Code</span>
            <input
              name="code"
              required
              placeholder="ISLAND_REDUCED"
              pattern="[A-Z0-9_]+"
              className="cms-input font-mono uppercase"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Ποσοστό %</span>
            <input
              name="ratePct"
              required
              type="number"
              step="0.01"
              min={0}
              max={99.99}
              placeholder="17"
              className="cms-input text-center font-mono"
            />
          </label>
          <label className="flex items-center gap-2 cursor-pointer rounded-md border border-foreground/15 bg-muted/30 px-3 py-2 hover:bg-muted/50 transition-colors">
            <input
              type="checkbox"
              name="isDefault"
              className=""
            />
            <span className="text-sm font-medium">Προεπιλογή</span>
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="btn btn-primary btn-md"
          >
            <span className="text-base leading-none">+</span> Προσθήκη
          </button>
        </form>
      </section>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      {/* Existing rates */}
      {rates.length === 0 ? (
        <div className="cms-empty">
          Δεν έχουν οριστεί κατηγορίες ΦΠΑ.
        </div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>Code</th>
                <th className="text-center">Ποσοστό</th>
                <th>Προεπιλογή</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rates
                .slice()
                .sort((a, b) => a.rate - b.rate)
                .map((rate) => (
                  <tr
                    key={rate.id}
                    className={rate.is_default ? "bg-muted/30" : ""}
                  >
                    <td>
                      <input
                        defaultValue={rate.name}
                        onBlur={(e) => handleUpdateName(rate, e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-transparent hover:border-foreground/30 focus:border-foreground focus:outline-none focus:ring-0 px-0 py-1 font-medium"
                      />
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {rate.code}
                    </td>
                    <td className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          max={99.99}
                          defaultValue={(rate.rate * 100).toFixed(2)}
                          onBlur={(e) =>
                            handleUpdateRate(rate, Number(e.target.value))
                          }
                          className="cms-input cms-input-sm w-20 text-center font-mono"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </td>
                    <td>
                      {rate.is_default ? (
                        <span className="cms-badge border-foreground bg-foreground text-background">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-background"
                            aria-hidden
                          />
                          Προεπιλογή
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleMakeDefault(rate)}
                          disabled={isPending}
                          className="btn btn-secondary btn-sm"
                        >
                          Όρισε ως προεπιλογή
                        </button>
                      )}
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(rate)}
                        disabled={isPending || rate.is_default}
                        className="btn btn-destructive btn-sm"
                        aria-label={`Διαγραφή κατηγορίας ${rate.name}`}
                        title={
                          rate.is_default
                            ? "Δεν διαγράφεται — ορίστε άλλη ως προεπιλογή πρώτα"
                            : "Διαγραφή"
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
