"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";
import type { VatRate } from "@/types/vat-rates";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type {
  AdminProductFilterParams,
  FkOp,
  TextOp,
  NumOp,
} from "@/lib/admin-products-filter/productFilters";

interface Props {
  initial: AdminProductFilterParams;
  categories: Pick<Category, "id" | "name">[];
  suppliers: Pick<Supplier, "id" | "name">[];
  vatRates: Pick<VatRate, "id" | "name" | "rate">[];
  attributes: Pick<Attribute, "id" | "slug" | "name">[];
  attributeValues: Pick<AttributeValue, "id" | "attribute_id" | "value">[];
  activeCount: number;
}

/**
 * Full-extent filter modal. Each field has an operator dropdown that
 * controls whether the value input is rendered:
 *   - FK / text fields: is / contains / empty / not_empty
 *   - Numeric ranges:   between / empty / not_empty
 * Form submission emits everything to URL params.
 */
export default function ProductsFilterModal({
  initial,
  categories,
  suppliers,
  vatRates,
  attributes,
  attributeValues,
  activeCount,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const [status, setStatus] = useState(initial.status ?? "");
  const [stock, setStock] = useState(initial.stock ?? "");

  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [categoryIdOp, setCategoryIdOp] = useState<FkOp>(initial.categoryIdOp ?? "is");

  const [supplierId, setSupplierId] = useState(initial.supplierId ?? "");
  const [supplierIdOp, setSupplierIdOp] = useState<FkOp>(initial.supplierIdOp ?? "is");

  const [vatRateId, setVatRateId] = useState(initial.vatRateId ?? "");
  const [vatRateIdOp, setVatRateIdOp] = useState<FkOp>(initial.vatRateIdOp ?? "is");

  const [brand, setBrand] = useState(initial.brand ?? "");
  const [brandOp, setBrandOp] = useState<TextOp>(initial.brandOp ?? "contains");

  const [minPrice, setMinPrice] = useState(initial.minPrice ?? "");
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice ?? "");
  const [priceOp, setPriceOp] = useState<NumOp>(initial.priceOp ?? "between");

  const [minAge, setMinAge] = useState(initial.minAge ?? "");
  const [maxAge, setMaxAge] = useState(initial.maxAge ?? "");
  const [ageOp, setAgeOp] = useState<NumOp>(initial.ageOp ?? "between");

  const [minWeight, setMinWeight] = useState(initial.minWeight ?? "");
  const [maxWeight, setMaxWeight] = useState(initial.maxWeight ?? "");
  const [weightOp, setWeightOp] = useState<NumOp>(initial.weightOp ?? "between");

  const [minCostPrice, setMinCostPrice] = useState(initial.minCostPrice ?? "");
  const [maxCostPrice, setMaxCostPrice] = useState(initial.maxCostPrice ?? "");
  const [costPriceOp, setCostPriceOp] = useState<NumOp>(initial.costPriceOp ?? "between");

  const [attrFilters, setAttrFilters] = useState<Array<{ slug: string; values: string[] }>>(
    initial.attributeFilters
      ? Object.entries(initial.attributeFilters).map(([slug, values]) => ({ slug, values }))
      : []
  );

  const valuesByAttrId = new Map<string, typeof attributeValues>();
  for (const v of attributeValues) {
    const list = valuesByAttrId.get(v.attribute_id) ?? [];
    list.push(v);
    valuesByAttrId.set(v.attribute_id, list);
  }

  function addAttrFilter() {
    setAttrFilters((cur) => [...cur, { slug: "", values: [] }]);
  }
  function updateAttrFilterSlug(idx: number, slug: string) {
    setAttrFilters((cur) => cur.map((f, i) => (i === idx ? { slug, values: [] } : f)));
  }
  function toggleAttrValue(idx: number, value: string, checked: boolean) {
    setAttrFilters((cur) =>
      cur.map((f, i) => {
        if (i !== idx) return f;
        const next = new Set(f.values);
        if (checked) next.add(value);
        else next.delete(value);
        return { ...f, values: Array.from(next) };
      })
    );
  }
  function removeAttrFilter(idx: number) {
    setAttrFilters((cur) => cur.filter((_, i) => i !== idx));
  }

  function apply() {
    const sp = new URLSearchParams();
    if (initial.q) sp.set("q", initial.q);
    if (status) sp.set("status", status);
    if (stock) sp.set("stock", stock);

    setFkParams(sp, "categoryId", categoryId, categoryIdOp);
    setFkParams(sp, "supplierId", supplierId, supplierIdOp);
    setFkParams(sp, "vatRateId", vatRateId, vatRateIdOp);
    setTextParams(sp, "brand", brand, brandOp);
    setNumParams(sp, "Price", minPrice, maxPrice, priceOp);
    setNumParams(sp, "Age", minAge, maxAge, ageOp);
    setNumParams(sp, "Weight", minWeight, maxWeight, weightOp);
    setNumParams(sp, "CostPrice", minCostPrice, maxCostPrice, costPriceOp);

    for (const f of attrFilters) {
      if (!f.slug || f.values.length === 0) continue;
      for (const v of f.values) sp.append(`attr_${f.slug}`, v);
    }
    setOpen(false);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function reset() {
    setStatus("");
    setStock("");
    setCategoryId("");
    setCategoryIdOp("is");
    setSupplierId("");
    setSupplierIdOp("is");
    setVatRateId("");
    setVatRateIdOp("is");
    setBrand("");
    setBrandOp("contains");
    setMinPrice("");
    setMaxPrice("");
    setPriceOp("between");
    setMinAge("");
    setMaxAge("");
    setAgeOp("between");
    setMinWeight("");
    setMaxWeight("");
    setWeightOp("between");
    setMinCostPrice("");
    setMaxCostPrice("");
    setCostPriceOp("between");
    setAttrFilters([]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-md"
      >
        Φίλτρα
        {activeCount > 0 && (
          <span className="text-[10px] rounded-full bg-foreground text-background w-4 h-4 inline-flex items-center justify-center font-semibold ml-0.5">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-12"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-background rounded shadow-lg w-full max-w-3xl p-6 space-y-3">
            <header className="flex items-center justify-between border-b pb-3">
              <h2 className="text-lg font-semibold">Πλήρη φίλτρα</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Κλείσιμο"
                className="text-2xl text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </header>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Ορατότητα</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1">
                  <option value="">— όλα —</option>
                  <option value="active">Ενεργά</option>
                  <option value="inactive">Ανενεργά</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Απόθεμα</span>
                <select value={stock} onChange={(e) => setStock(e.target.value)} className="border rounded px-2 py-1">
                  <option value="">— όλα —</option>
                  <option value="ok">Διαθέσιμα</option>
                  <option value="low">Χαμηλό</option>
                  <option value="out">Άδεια</option>
                </select>
              </label>
            </div>

            <FkFieldRow
              label="Κατηγορία"
              op={categoryIdOp}
              setOp={setCategoryIdOp}
              value={categoryId}
              setValue={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <FkFieldRow
              label="Προμηθευτής"
              op={supplierIdOp}
              setOp={setSupplierIdOp}
              value={supplierId}
              setValue={setSupplierId}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
            <FkFieldRow
              label="ΦΠΑ"
              op={vatRateIdOp}
              setOp={setVatRateIdOp}
              value={vatRateId}
              setValue={setVatRateId}
              options={vatRates.map((r) => ({
                value: r.id,
                label: `${r.name} (${(r.rate * 100).toFixed(0)}%)`,
              }))}
            />
            <TextFieldRow
              label="Μάρκα"
              op={brandOp}
              setOp={setBrandOp}
              value={brand}
              setValue={setBrand}
            />
            <NumRangeRow
              label="Τιμή (€)"
              op={priceOp}
              setOp={setPriceOp}
              min={minPrice}
              setMin={setMinPrice}
              max={maxPrice}
              setMax={setMaxPrice}
            />
            <NumRangeRow
              label="Ηλικία (έτη)"
              op={ageOp}
              setOp={setAgeOp}
              min={minAge}
              setMin={setMinAge}
              max={maxAge}
              setMax={setMaxAge}
            />
            <NumRangeRow
              label="Βάρος (g)"
              op={weightOp}
              setOp={setWeightOp}
              min={minWeight}
              setMin={setMinWeight}
              max={maxWeight}
              setMax={setMaxWeight}
            />
            <NumRangeRow
              label="Κόστος μονάδας"
              op={costPriceOp}
              setOp={setCostPriceOp}
              min={minCostPrice}
              setMin={setMinCostPrice}
              max={maxCostPrice}
              setMax={setMaxCostPrice}
            />

            <fieldset className="border-t pt-3 space-y-2 text-sm">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Φίλτρα ανά χαρακτηριστικό
              </legend>
              <p className="text-xs text-muted-foreground">
                Ταιριάζει αν το προϊόν έχει αυτό το χαρακτηριστικό ως προδιαγραφή ή αν κάποιο variant του έχει αυτή την τιμή στο combo.
              </p>

              {attrFilters.map((f, idx) => {
                const attr = attributes.find((a) => a.slug === f.slug);
                const valuesAvailable = attr ? valuesByAttrId.get(attr.id) ?? [] : [];
                return (
                  <div key={idx} className="border rounded p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <select
                        value={f.slug}
                        onChange={(e) => updateAttrFilterSlug(idx, e.target.value)}
                        className="border rounded px-2 py-1 text-xs flex-1"
                      >
                        <option value="">— επιλέξτε χαρακτηριστικό —</option>
                        {attributes.map((a) => (
                          <option key={a.id} value={a.slug}>{a.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeAttrFilter(idx)}
                        className="text-destructive text-xs"
                        aria-label="Αφαίρεση"
                      >
                        ✕
                      </button>
                    </div>
                    {attr && valuesAvailable.length > 0 && (
                      <div className="flex flex-wrap gap-1 ml-2">
                        {valuesAvailable.map((v) => (
                          <label key={v.id} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={f.values.includes(v.id)}
                              onChange={(e) => toggleAttrValue(idx, v.id, e.target.checked)}
                            />
                            <span>{v.value}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <button type="button" onClick={addAttrFilter} className="text-xs text-primary underline">
                + Προσθήκη φίλτρου χαρακτηριστικού
              </button>
            </fieldset>

            <footer className="flex items-center justify-between border-t pt-3">
              <button type="button" onClick={reset} className="text-xs text-muted-foreground underline">
                Καθαρισμός όλων
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Ακύρωση
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm"
                >
                  Εφαρμογή
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FkFieldRow({
  label,
  op,
  setOp,
  value,
  setValue,
  options,
}: {
  label: string;
  op: FkOp;
  setOp: (v: FkOp) => void;
  value: string;
  setValue: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="grid grid-cols-[140px_140px_1fr] gap-2 items-end text-sm">
      <span className="text-xs text-muted-foreground self-center">{label}</span>
      <select value={op} onChange={(e) => setOp(e.target.value as FkOp)} className="border rounded px-2 py-1 text-xs">
        <option value="is">είναι</option>
        <option value="empty">κενό</option>
        <option value="not_empty">οποιοδήποτε</option>
      </select>
      {op === "is" ? (
        <select value={value} onChange={(e) => setValue(e.target.value)} className="border rounded px-2 py-1">
          <option value="">— επιλέξτε —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-muted-foreground italic self-center">
          {op === "empty" ? "(προϊόντα χωρίς αυτή την ανάθεση)" : "(προϊόντα με οποιαδήποτε ανάθεση)"}
        </span>
      )}
    </div>
  );
}

function TextFieldRow({
  label,
  op,
  setOp,
  value,
  setValue,
}: {
  label: string;
  op: TextOp;
  setOp: (v: TextOp) => void;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[140px_140px_1fr] gap-2 items-end text-sm">
      <span className="text-xs text-muted-foreground self-center">{label}</span>
      <select value={op} onChange={(e) => setOp(e.target.value as TextOp)} className="border rounded px-2 py-1 text-xs">
        <option value="contains">περιέχει</option>
        <option value="empty">κενό</option>
        <option value="not_empty">έχει τιμή</option>
      </select>
      {op === "contains" ? (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ανεξαρτήτως κεφαλαίων / πεζών"
          className="border rounded px-2 py-1"
        />
      ) : (
        <span className="text-xs text-muted-foreground italic self-center">
          {op === "empty" ? "(πεδίο κενό ή NULL)" : "(πεδίο με οποιαδήποτε τιμή)"}
        </span>
      )}
    </div>
  );
}

function NumRangeRow({
  label,
  op,
  setOp,
  min,
  setMin,
  max,
  setMax,
}: {
  label: string;
  op: NumOp;
  setOp: (v: NumOp) => void;
  min: string;
  setMin: (v: string) => void;
  max: string;
  setMax: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[140px_140px_1fr] gap-2 items-end text-sm">
      <span className="text-xs text-muted-foreground self-center">{label}</span>
      <select value={op} onChange={(e) => setOp(e.target.value as NumOp)} className="border rounded px-2 py-1 text-xs">
        <option value="between">μεταξύ</option>
        <option value="empty">κενό</option>
        <option value="not_empty">έχει τιμή</option>
      </select>
      {op === "between" ? (
        <div className="flex gap-2">
          <input
            type="number"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            placeholder="από"
            className="border rounded px-2 py-1 w-full"
          />
          <input
            type="number"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            placeholder="έως"
            className="border rounded px-2 py-1 w-full"
          />
        </div>
      ) : (
        <span className="text-xs text-muted-foreground italic self-center">
          {op === "empty" ? "(τιμή NULL)" : "(τιμή υπάρχει)"}
        </span>
      )}
    </div>
  );
}

// ─── URL emission helpers ─────────────────────────────────────────────────────

function setFkParams(sp: URLSearchParams, key: string, value: string, op: FkOp) {
  if (op === "empty" || op === "not_empty") {
    sp.set(`${key}Op`, op);
  } else if (value) {
    sp.set(key, value);
  }
}
function setTextParams(sp: URLSearchParams, key: string, value: string, op: TextOp) {
  if (op === "empty" || op === "not_empty") {
    sp.set(`${key}Op`, op);
  } else if (value.trim()) {
    sp.set(key, value.trim());
  }
}
function setNumParams(
  sp: URLSearchParams,
  suffix: string,
  min: string,
  max: string,
  op: NumOp
) {
  const opKey = suffix.charAt(0).toLowerCase() + suffix.slice(1) + "Op";
  if (op === "empty" || op === "not_empty") {
    sp.set(opKey, op);
  } else {
    if (min) sp.set(`min${suffix}`, min);
    if (max) sp.set(`max${suffix}`, max);
  }
}
