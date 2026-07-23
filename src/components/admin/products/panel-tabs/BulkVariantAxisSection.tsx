"use client";

import { useMemo, useState } from "react";
import { previewBulkVariantAxis } from "@/actions/variants/previewBulkVariantAxis";
import { applyBulkVariantAxis } from "@/actions/variants/applyBulkVariantAxis";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

/**
 * Bulk additive variant-axis op in the panel's bulk-edit mode. Pick an
 * attribute + value(s) → preview which products lack them → confirm (the
 * modal shows a per-value product breakdown) → create the missing combos.
 * Additive only; never removes/overwrites existing variants.
 */
export default function BulkVariantAxisSection({
  productIds,
  attributes,
  attributeValues,
}: {
  productIds: string[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
}) {
  const { confirmPropagate } = useBulkPropagation();
  const [attributeId, setAttributeId] = useState("");
  const [valueIds, setValueIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attr = attributes.find((a) => a.id === attributeId) ?? null;
  const values = useMemo(
    () => attributeValues.filter((v) => v.attribute_id === attributeId),
    [attributeValues, attributeId]
  );

  function toggleValue(id: string) {
    setValueIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (!attr || valueIds.size === 0) return;
    setError(null);
    setResult(null);
    setBusy(true);
    const ids = Array.from(valueIds);
    const preview = await previewBulkVariantAxis({
      productIds,
      attributeSlug: attr.slug,
      valueIds: ids,
    });
    setBusy(false);
    if (!preview.ok) {
      setError(preview.error);
      return;
    }
    if (preview.affectedProducts === 0) {
      setResult("Όλα τα επιλεγμένα προϊόντα έχουν ήδη αυτές τις τιμές.");
      return;
    }
    const valueName = (id: string) =>
      values.find((v) => v.id === id)?.value ?? id;
    const breakdown = ids
      .filter((id) => (preview.perValueProductCount[id] ?? 0) > 0)
      .map(
        (id) =>
          `${attr.name}=${valueName(id)} → ${preview.perValueProductCount[id]} προϊ.`
      )
      .join(" · ");
    const applied = await confirmPropagate({
      count: preview.affectedProducts,
      message: `${breakdown} (σύνολο ${preview.totalCombos} νέοι συνδυασμοί)`,
      apply: async () => {
        const r = await applyBulkVariantAxis({
          productIds,
          attributeSlug: attr.slug,
          valueIds: ids,
        });
        return { success: r.success, error: r.success ? undefined : r.error };
      },
    });
    if (applied) {
      setResult(
        `Δημιουργήθηκαν ${preview.totalCombos} συνδυασμοί σε ${preview.affectedProducts} προϊόντα.`
      );
      setValueIds(new Set());
    }
  }

  return (
    <section className="mt-6 pt-4 border-t border-foreground/10 space-y-3">
      <h2 className="text-sm font-semibold">Παραλλαγές — προσθήκη άξονα/τιμής</h2>
      <p className="text-xs text-muted-foreground">
        Προσθήκη χαρακτηριστικού/τιμών στη μήτρα παραλλαγών — μόνο στα προϊόντα
        που τα στερούνται. Δεν αφαιρεί ούτε αντικαθιστά υπάρχουσες παραλλαγές.
      </p>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium">Χαρακτηριστικό</span>
        <select
          value={attributeId}
          onChange={(e) => {
            setAttributeId(e.target.value);
            setValueIds(new Set());
          }}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="">— επιλέξτε —</option>
          {attributes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {attr && (
        <div className="space-y-1">
          <span className="text-xs font-medium">Τιμές</span>
          {values.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Καμία τιμή για αυτό το χαρακτηριστικό.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {values.map((v) => (
                <label key={v.id} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={valueIds.has(v.id)}
                    onChange={() => toggleValue(v.id)}
                  />
                  <span>{v.value}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && <p className="text-xs text-emerald-700">{result}</p>}

      <button
        type="button"
        onClick={apply}
        disabled={!attr || valueIds.size === 0 || busy}
        className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "Υπολογισμός…" : "Προσθήκη"}
      </button>
    </section>
  );
}
