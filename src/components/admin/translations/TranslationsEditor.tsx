"use client";

import { useState, useTransition } from "react";
import { upsertTranslation } from "@/actions/translations/upsertTranslation";
import { deleteTranslation } from "@/actions/translations/deleteTranslation";
import type { Translation } from "@/types/translation-layer";

export default function TranslationsEditor({
  initial,
}: {
  initial: Translation[];
}) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function setDraft(id: string, value: string) {
    setDrafts((d) => ({ ...d, [id]: value }));
  }

  function save(row: Translation) {
    const newValue = drafts[row.id];
    if (newValue === undefined || newValue === row.value) return;
    setError(null);
    startTransition(async () => {
      const r = await upsertTranslation({
        namespace: row.namespace,
        key: row.key,
        locale: row.locale,
        value: newValue,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setRows((cur) => cur.map((x) => (x.id === row.id ? { ...x, value: newValue } : x)));
      setDrafts((d) => {
        const { [row.id]: _, ...rest } = d;
        return rest;
      });
    });
  }

  function remove(row: Translation) {
    if (!confirm(`Διαγραφή ${row.namespace}.${row.key} (${row.locale});`)) return;
    setError(null);
    const prev = rows;
    setRows((cur) => cur.filter((x) => x.id !== row.id));
    startTransition(async () => {
      const r = await deleteTranslation({ id: row.id });
      if (!r.success) {
        setError(r.error);
        setRows(prev);
      }
    });
  }

  function addRow(formData: FormData) {
    const namespace = String(formData.get("namespace") ?? "");
    const key = String(formData.get("key") ?? "");
    const locale = String(formData.get("locale") ?? "");
    const value = String(formData.get("value") ?? "");
    if (!namespace || !key || !locale) {
      setError("Συμπληρώστε namespace, key και locale.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await upsertTranslation({ namespace, key, locale, value });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setRows((cur) => [r.data, ...cur.filter((x) => x.id !== r.data.id)]);
    });
  }

  return (
    <div className="space-y-4">
      <form action={addRow} className="grid grid-cols-4 gap-2 border rounded p-3 text-sm">
        <input name="namespace" placeholder="namespace" required className="border rounded px-2 py-1" />
        <input name="key" placeholder="key" required className="border rounded px-2 py-1 font-mono" />
        <input name="locale" placeholder="locale" required maxLength={10} className="border rounded px-2 py-1" />
        <button type="submit" disabled={isPending} className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm">
          + Προσθήκη
        </button>
        <input
          name="value"
          placeholder="μετάφραση..."
          required
          className="col-span-4 border rounded px-2 py-1"
        />
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Δεν υπάρχουν μεταφράσεις.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Namespace</th>
              <th className="py-2">Key</th>
              <th className="py-2">Locale</th>
              <th className="py-2">Value</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 font-mono text-xs">{r.namespace}</td>
                <td className="py-2 font-mono text-xs">{r.key}</td>
                <td className="py-2">{r.locale}</td>
                <td className="py-2">
                  <input
                    defaultValue={r.value}
                    onChange={(e) => setDraft(r.id, e.target.value)}
                    onBlur={() => save(r)}
                    className="w-full border rounded px-2 py-1"
                  />
                </td>
                <td className="py-2">
                  <button
                    onClick={() => remove(r)}
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
      )}
    </div>
  );
}
