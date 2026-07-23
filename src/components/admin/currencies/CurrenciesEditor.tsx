"use client";

import { useState, useTransition } from "react";
import { upsertCurrency } from "@/actions/currencies/upsertCurrency";
import { deleteCurrency } from "@/actions/currencies/deleteCurrency";
import type { Currency } from "@/types/multi-currency";

export default function CurrenciesEditor({ initial }: { initial: Currency[] }) {
  const [rows, setRows] = useState<Currency[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(idx: number, patch: Partial<Currency>) {
    setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function save(row: Currency) {
    setError(null);
    startTransition(async () => {
      const r = await upsertCurrency({
        code: row.code,
        name: row.name,
        symbol: row.symbol,
        exchangeRate: Number(row.exchange_rate),
        decimalDigits: row.decimal_digits,
        active: row.active,
      });
      if (!r.success) setError(r.error);
    });
  }

  function remove(code: string) {
    if (!confirm(`Διαγραφή νομίσματος ${code};`)) return;
    setError(null);
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.code !== code));
    startTransition(async () => {
      const r = await deleteCurrency({ code });
      if (!r.success) {
        setError(r.error);
        setRows(prev);
      }
    });
  }

  function addRow() {
    setRows((cur) => [
      ...cur,
      {
        code: "",
        name: "",
        symbol: "",
        exchange_rate: 1,
        decimal_digits: 2,
        active: true,
        updated_at: new Date().toISOString(),
      },
    ]);
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Code</th>
            <th className="py-2">Όνομα</th>
            <th className="py-2">Σύμβολο</th>
            <th className="py-2">Rate</th>
            <th className="py-2">Decimals</th>
            <th className="py-2">Ενεργό</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.code}-${i}`} className="border-b">
              <td className="py-2">
                <input
                  value={r.code}
                  onChange={(e) => update(i, { code: e.target.value.toUpperCase() })}
                  maxLength={3}
                  className="w-16 border rounded px-2 py-1 uppercase font-mono"
                />
              </td>
              <td className="py-2">
                <input
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="border rounded px-2 py-1"
                />
              </td>
              <td className="py-2">
                <input
                  value={r.symbol}
                  onChange={(e) => update(i, { symbol: e.target.value })}
                  className="w-16 border rounded px-2 py-1 text-center"
                />
              </td>
              <td className="py-2">
                <input
                  type="number"
                  step="0.000001"
                  value={r.exchange_rate}
                  onChange={(e) => update(i, { exchange_rate: Number(e.target.value) })}
                  className="w-28 border rounded px-2 py-1 text-center"
                />
              </td>
              <td className="py-2">
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={r.decimal_digits}
                  onChange={(e) => update(i, { decimal_digits: Number(e.target.value) })}
                  className="w-16 border rounded px-2 py-1 text-center"
                />
              </td>
              <td className="py-2">
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={(e) => update(i, { active: e.target.checked })}
                />
              </td>
              <td className="py-2 flex gap-2">
                <button
                  onClick={() => save(r)}
                  disabled={isPending || !r.code || r.code.length !== 3}
                  className="rounded border px-2 py-0.5 text-sm"
                >
                  Save
                </button>
                <button
                  onClick={() => remove(r.code)}
                  disabled={isPending}
                  className="text-sm text-destructive underline"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={addRow} className="rounded border px-3 py-1 text-sm">+ Νέο νόμισμα</button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
