"use client";

import { useEffect, useState } from "react";
import { getCustomFieldPickerOptions } from "@/actions/custom-fields/getCustomFieldPickerOptions";
import { bulkAssignCustomField } from "@/actions/custom-fields/bulkAssignCustomField";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";

/**
 * Bulk custom-field assignment, shown in the panel's bulk-edit mode.
 * Pick a field or group + required setting → assign it to all selected
 * products (add-or-override). Confirmation count comes from the shared
 * bulk-propagation modal.
 */
export default function BulkCustomFieldsSection({
  productIds,
  affectedCount,
}: {
  productIds: string[];
  affectedCount: number;
}) {
  const { confirmPropagate } = useBulkPropagation();
  const [opts, setOpts] = useState<Awaited<
    ReturnType<typeof getCustomFieldPickerOptions>
  > | null>(null);
  const [target, setTarget] = useState(""); // "field:<id>" | "group:<id>"
  const [required, setRequired] = useState<"inherit" | "required" | "optional">(
    "inherit"
  );
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getCustomFieldPickerOptions()
      .then((o) => {
        if (alive) setOpts(o);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function apply() {
    if (!target) return;
    const [kind, id] = target.split(":");
    const overrideRequired =
      required === "inherit" ? null : required === "required";
    setResult(null);
    const applied = await confirmPropagate({
      count: affectedCount,
      message: "το προσαρμοσμένο πεδίο/ομάδα",
      apply: async () => {
        const r = await bulkAssignCustomField({
          productIds,
          fieldId: kind === "field" ? id : null,
          groupId: kind === "group" ? id : null,
          overrideRequired,
        });
        return { success: r.success, error: r.success ? undefined : r.error };
      },
    });
    if (applied) {
      setResult("Εφαρμόστηκε σε όλα τα επιλεγμένα προϊόντα.");
      setTarget("");
    }
  }

  return (
    <section className="mt-6 pt-4 border-t border-foreground/10 space-y-3">
      <h2 className="text-sm font-semibold">Προσαρμόσιμα πεδία</h2>
      <p className="text-xs text-muted-foreground">
        Ανάθεση πεδίου ή ομάδας σε όλα τα επιλεγμένα προϊόντα (δημιουργία ή
        ενημέρωση της απαίτησης). Η αναλυτική διαχείριση γίνεται στην ενότητα
        Προσαρμόσιμα πεδία.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Πεδίο / Ομάδα</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!opts}
            className="border rounded px-2 py-1.5 text-sm"
          >
            <option value="">— επιλέξτε —</option>
            {opts && opts.fields.length > 0 && (
              <optgroup label="Πεδία">
                {opts.fields.map((f) => (
                  <option key={f.id} value={`field:${f.id}`}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            )}
            {opts && opts.groups.length > 0 && (
              <optgroup label="Ομάδες">
                {opts.groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Απαίτηση</span>
          <select
            value={required}
            onChange={(e) =>
              setRequired(e.target.value as "inherit" | "required" | "optional")
            }
            className="border rounded px-2 py-1.5 text-sm"
          >
            <option value="inherit">Κληρονομικό (προεπιλογή πεδίου)</option>
            <option value="required">Υποχρεωτικό</option>
            <option value="optional">Προαιρετικό</option>
          </select>
        </label>
      </div>

      {result && <p className="text-xs text-emerald-700">{result}</p>}

      <button
        type="button"
        onClick={apply}
        disabled={!target}
        className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
      >
        Ανάθεση σε {affectedCount} προϊόντα
      </button>
    </section>
  );
}
