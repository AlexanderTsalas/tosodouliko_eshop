"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkUpdateProducts } from "@/actions/products/bulkUpdateProducts";
import { Info, Tag, Truck, Eye, Layers } from "@/components/admin/common/icons";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";
import type { VatRate } from "@/types/vat-rates";
import type { Supplier } from "@/types/suppliers";
import type { Category } from "@/types/category-navigation";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { VolumetricPrefix } from "@/types/volumetric";

/**
 * Bulk Overview — the multi-product editor laid out to MATCH the
 * single-product Overview (ProductForm): same `cms-card-section`
 * sections, `cms-input` primitives, icons and grid. The bulk semantics
 * are expressed inline rather than with a separate tri-state widget:
 *
 *   - text / number fields:  empty = leave unchanged · typed = set on all
 *   - select fields:         "— Άφησε —" = leave · "— Καθαρισμός —" = null · value = set
 *   - toggles (3-state):     Άφησε / Ναι / Όχι
 *   - categories / specs / supplier-link: explicit op pickers
 *
 * One "Εφαρμογή σε N" submit → bulkUpdateProducts (mirrors the form's
 * batch save). Name / slug / SKU are intentionally absent (identity
 * fields, never bulk-set).
 */

type FieldOp = { mode: "set"; value: unknown } | { mode: "clear" } | undefined;
type TriState = "leave" | "yes" | "no";

interface Props {
  productIds: string[];
  matchAll: boolean;
  filterParams?: AdminProductFilterParams;
  affectedCount: number;
  vatRates: VatRate[];
  suppliers: Supplier[];
  categories: Category[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
  volumetricPrefixes: VolumetricPrefix[];
}

interface ResultState {
  succeeded: number;
  failed: Array<{ id: string; reason: string }>;
}

const CLEAR = "__clear__";

export default function BulkOverviewForm({
  productIds,
  matchAll,
  filterParams,
  affectedCount,
  vatRates,
  suppliers,
  categories,
  attributes,
  attributeValues,
  volumetricPrefixes,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultState | null>(null);

  // Scalars — empty string = "leave unchanged".
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [currency, setCurrency] = useState(""); // "" = leave
  const [vatRateId, setVatRateId] = useState(""); // "" leave · CLEAR · id
  const [costPrice, setCostPrice] = useState("");
  const [costCurrency, setCostCurrency] = useState("");
  const [weightG, setWeightG] = useState("");
  const [lengthMm, setLengthMm] = useState("");
  const [widthMm, setWidthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [volumetricPrefixId, setVolumetricPrefixId] = useState("");
  const [active, setActive] = useState<TriState>("leave");
  const [showWhenOos, setShowWhenOos] = useState<TriState>("leave");
  const [defaultSupplierId, setDefaultSupplierId] = useState("");

  // Category op
  const [categoryMode, setCategoryMode] = useState<
    "none" | "add" | "remove" | "replace"
  >("none");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    new Set()
  );

  // Spec op
  const [specMode, setSpecMode] = useState<
    "none" | "add" | "remove" | "replace"
  >("none");
  const [specAttrId, setSpecAttrId] = useState("");
  const [specValue, setSpecValue] = useState("");

  // Supplier-link op
  const [supplierLinkOn, setSupplierLinkOn] = useState(false);
  const [supplierLinkId, setSupplierLinkId] = useState("");

  const valuesByAttr = new Map<string, AttributeValue[]>();
  for (const v of attributeValues) {
    const list = valuesByAttr.get(v.attribute_id) ?? [];
    list.push(v);
    valuesByAttr.set(v.attribute_id, list);
  }

  // ── tri-state → FieldOp helpers ───────────────────────────────────
  const numOp = (raw: string): FieldOp =>
    raw.trim() === "" ? undefined : { mode: "set", value: Number(raw) };
  const textOp = (raw: string, upper = false): FieldOp =>
    raw.trim() === ""
      ? undefined
      : { mode: "set", value: upper ? raw.trim().toUpperCase() : raw.trim() };
  const selectOp = (raw: string): FieldOp =>
    raw === ""
      ? undefined
      : raw === CLEAR
        ? { mode: "clear" }
        : { mode: "set", value: raw };
  const boolOp = (s: TriState): FieldOp =>
    s === "leave" ? undefined : { mode: "set", value: s === "yes" };

  function handleSubmit() {
    setError(null);

    const scalars = {
      description: textOp(description),
      basePrice: numOp(basePrice),
      currency: textOp(currency, true),
      brand: textOp(brand),
      active: boolOp(active),
      showWhenOos: boolOp(showWhenOos),
      weightG: numOp(weightG),
      lengthMm: numOp(lengthMm),
      widthMm: numOp(widthMm),
      heightMm: numOp(heightMm),
      volumetricPrefixId: selectOp(volumetricPrefixId),
      ageMin: numOp(ageMin),
      ageMax: numOp(ageMax),
      vatRateId: selectOp(vatRateId),
      costPrice: numOp(costPrice),
      costCurrency: textOp(costCurrency, true),
      defaultSupplierId: selectOp(defaultSupplierId),
    };

    const categoryOp =
      categoryMode === "none"
        ? undefined
        : { op: categoryMode, categoryIds: Array.from(selectedCategoryIds) };

    const specOp =
      specMode === "none" || !specAttrId
        ? undefined
        : specMode === "remove"
          ? { op: "remove" as const, attributeId: specAttrId }
          : { op: specMode, attributeId: specAttrId, value: specValue };

    const supplierLinkOp =
      supplierLinkOn && supplierLinkId
        ? { supplierId: supplierLinkId, isPreferred: true }
        : undefined;

    const hasAnyOp =
      Object.values(scalars).some((s) => s !== undefined) ||
      categoryOp !== undefined ||
      specOp !== undefined ||
      supplierLinkOp !== undefined;
    if (!hasAnyOp) {
      setError("Δεν έχει συμπληρωθεί κανένα πεδίο προς αλλαγή.");
      return;
    }

    startTransition(async () => {
      const r = await bulkUpdateProducts({
        ids: matchAll ? null : productIds,
        matchAll,
        filterParams,
        scalars,
        categoryOp,
        specOp,
        supplierLinkOp,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setResult(r.data);
    });
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4">
          <h2 className="font-semibold text-emerald-900 text-sm">
            Ολοκληρώθηκε: {result.succeeded} επιτυχ
            {result.succeeded === 1 ? "ία" : "ίες"}
            {result.failed.length > 0 &&
              ` · ${result.failed.length} αποτυχ${
                result.failed.length === 1 ? "ία" : "ίες"
              }`}
          </h2>
        </div>
        {result.failed.length > 0 && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3">
            <h3 className="font-medium text-xs mb-2">Αποτυχίες</h3>
            <ul className="text-xs space-y-1">
              {result.failed.map((f) => (
                <li key={f.id} className="font-mono">
                  {f.id.slice(0, 8)}: {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setResult(null);
            router.refresh();
          }}
          className="btn btn-secondary btn-sm"
        >
          Νέα ομαδική επεξεργασία
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-foreground/15 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Τα <strong>κενά πεδία παραμένουν αμετάβλητα</strong>. Συμπληρώστε μόνο
        όσα θέλετε να εφαρμοστούν και στα <strong>{affectedCount}</strong>{" "}
        επιλεγμένα προϊόντα. Όνομα, slug και SKU επεξεργάζονται μόνο μεμονωμένα.
      </p>

      {/* ─── Βασικά ─────────────────────────────────────────────── */}
      <section className="cms-card-section space-y-5">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Info className="w-4 h-4" />
            Βασικά
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Μάρκα</span>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="— άφησε —"
              className="cms-input"
            />
          </label>
          <div className="block">
            <span className="block text-sm font-medium mb-1.5">
              Ηλικιακό εύρος
            </span>
            <div className="cms-input flex items-center gap-2 px-2.5 py-0 focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15">
              <input
                type="number"
                min={0}
                max={99}
                value={ageMin}
                onChange={(e) => setAgeMin(e.target.value)}
                placeholder="—"
                aria-label="Ηλικία ελάχιστη"
                className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
              />
              <span className="text-muted-foreground font-bold select-none">
                –
              </span>
              <input
                type="number"
                min={0}
                max={99}
                value={ageMax}
                onChange={(e) => setAgeMax(e.target.value)}
                placeholder="—"
                aria-label="Ηλικία μέγιστη"
                className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
              />
              <span className="text-xs text-muted-foreground select-none pr-1">
                ετών
              </span>
            </div>
          </div>
          <label className="block md:col-span-2">
            <span className="block text-sm font-medium mb-1.5">Περιγραφή</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="— άφησε —"
              className="cms-input"
              style={{ height: "auto", minHeight: "5rem" }}
            />
          </label>
        </div>
      </section>

      {/* ─── Τιμολόγηση ─────────────────────────────────────────── */}
      <section className="cms-card-section space-y-5">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Tag className="w-4 h-4" />
            Τιμολόγηση
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">
              Βασική τιμή
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="— άφησε —"
              className="cms-input font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Νόμισμα</span>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="— άφησε —"
              className="cms-input font-mono uppercase"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="block text-sm font-medium mb-1.5">
              Κατηγορία ΦΠΑ
            </span>
            <select
              value={vatRateId}
              onChange={(e) => setVatRateId(e.target.value)}
              className="cms-input"
            >
              <option value="">— άφησε —</option>
              <option value={CLEAR}>— καθαρισμός —</option>
              {vatRates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({(r.rate * 100).toFixed(0)}%)
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">
              Κόστος μονάδας
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder="— άφησε —"
              className="cms-input font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">
              Νόμισμα κόστους
            </span>
            <input
              value={costCurrency}
              onChange={(e) => setCostCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="— άφησε —"
              className="cms-input font-mono uppercase"
            />
          </label>
        </div>
      </section>

      {/* ─── Logistics ──────────────────────────────────────────── */}
      <section className="cms-card-section space-y-5">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Logistics
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Βάρος (g)</span>
            <input
              type="number"
              min={0}
              value={weightG}
              onChange={(e) => setWeightG(e.target.value)}
              placeholder="— άφησε —"
              className="cms-input font-mono"
            />
          </label>
          <div className="block">
            <span className="block text-sm font-medium mb-1.5">
              Διαστάσεις (mm){" "}
              <span className="text-xs text-muted-foreground font-normal">
                · Μ × Π × Υ
              </span>
            </span>
            <div className="cms-input flex items-center gap-2 px-2.5 py-0 focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15">
              <input
                type="number"
                min={1}
                value={lengthMm}
                onChange={(e) => setLengthMm(e.target.value)}
                placeholder="μήκος"
                aria-label="Μήκος (mm)"
                className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
              />
              <span className="text-muted-foreground select-none">×</span>
              <input
                type="number"
                min={1}
                value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)}
                placeholder="πλάτος"
                aria-label="Πλάτος (mm)"
                className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
              />
              <span className="text-muted-foreground select-none">×</span>
              <input
                type="number"
                min={1}
                value={heightMm}
                onChange={(e) => setHeightMm(e.target.value)}
                placeholder="ύψος"
                aria-label="Ύψος (mm)"
                className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
              />
            </div>
          </div>
          {volumetricPrefixes.length > 0 && (
            <label className="block md:col-span-2">
              <span className="block text-sm font-medium mb-1.5">
                Κατηγορία μεγέθους
              </span>
              <select
                value={volumetricPrefixId}
                onChange={(e) => setVolumetricPrefixId(e.target.value)}
                className="cms-input"
              >
                <option value="">— άφησε —</option>
                <option value={CLEAR}>— καθαρισμός —</option>
                {volumetricPrefixes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {/* ─── Ορατότητα ──────────────────────────────────────────── */}
      <section className="cms-card-section">
        <header className="pb-3 mb-4 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Ορατότητα
          </h2>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-start justify-between gap-3 rounded-md border border-foreground/15 bg-background px-4 py-3">
            <div>
              <p className="text-sm font-medium">Ενεργό</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ορατό στο κατάστημα.
              </p>
            </div>
            <TriToggle value={active} onChange={setActive} ariaLabel="Ενεργό" />
          </label>
          <label className="flex items-start justify-between gap-3 rounded-md border border-foreground/15 bg-background px-4 py-3">
            <div>
              <p className="text-sm font-medium">Ορατό όταν εξαντλείται</p>
              <p className="text-xs text-muted-foreground mt-1">
                Κρατά το προϊόν ορατό σε μηδενικό απόθεμα.
              </p>
            </div>
            <TriToggle
              value={showWhenOos}
              onChange={setShowWhenOos}
              ariaLabel="Ορατό όταν εξαντλείται"
            />
          </label>
        </div>
      </section>

      {/* ─── Προμηθευτής ────────────────────────────────────────── */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Προμηθευτής
          </h2>
        </header>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Προεπιλεγμένος προμηθευτής
          </span>
          <select
            value={defaultSupplierId}
            onChange={(e) => setDefaultSupplierId(e.target.value)}
            className="cms-input"
          >
            <option value="">— άφησε —</option>
            <option value={CLEAR}>— καθαρισμός —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={supplierLinkOn}
            onChange={(e) => setSupplierLinkOn(e.target.checked)}
          />
          <span>
            Σύνδεση προμηθευτή σε όλες τις παραλλαγές (μόνο όπου λείπει)
          </span>
        </label>
        {supplierLinkOn && (
          <select
            value={supplierLinkId}
            onChange={(e) => setSupplierLinkId(e.target.value)}
            className="cms-input"
          >
            <option value="">— επιλέξτε προμηθευτή —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* ─── Κατηγορίες ─────────────────────────────────────────── */}
      <section className="cms-card-section space-y-3">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Κατηγορίες
          </h2>
        </header>
        <div className="flex flex-wrap gap-3 text-xs">
          {(["none", "add", "remove", "replace"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-1">
              <input
                type="radio"
                name="bulkCategoryMode"
                checked={categoryMode === mode}
                onChange={() => setCategoryMode(mode)}
              />
              <span>
                {mode === "none" && "Διατήρηση"}
                {mode === "add" && "Προσθήκη σε"}
                {mode === "remove" && "Αφαίρεση από"}
                {mode === "replace" && "Αντικατάσταση με"}
              </span>
            </label>
          ))}
        </div>
        {categoryMode !== "none" && (
          <div className="grid grid-cols-2 gap-1 text-xs max-h-48 overflow-y-auto">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.has(c.id)}
                  onChange={(e) =>
                    setSelectedCategoryIds((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* ─── Προδιαγραφές ───────────────────────────────────────── */}
      <section className="cms-card-section space-y-3">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Προδιαγραφές
          </h2>
        </header>
        <div className="flex flex-wrap gap-3 text-xs">
          {(["none", "add", "remove", "replace"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-1">
              <input
                type="radio"
                name="bulkSpecMode"
                checked={specMode === mode}
                onChange={() => setSpecMode(mode)}
              />
              <span>
                {mode === "none" && "Διατήρηση"}
                {mode === "add" && "Προσθήκη"}
                {mode === "remove" && "Αφαίρεση"}
                {mode === "replace" && "Αντικατάσταση"}
              </span>
            </label>
          ))}
        </div>
        {specMode !== "none" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium mb-1">
                Χαρακτηριστικό
              </span>
              <select
                value={specAttrId}
                onChange={(e) => {
                  setSpecAttrId(e.target.value);
                  setSpecValue("");
                }}
                className="cms-input"
              >
                <option value="">— επιλέξτε —</option>
                {attributes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {specMode !== "remove" && (
              <label className="block">
                <span className="block text-xs font-medium mb-1">Τιμή</span>
                <input
                  value={specValue}
                  onChange={(e) => setSpecValue(e.target.value)}
                  list={specAttrId ? "bulk-spec-vals" : undefined}
                  className="cms-input"
                />
                {specAttrId && (
                  <datalist id="bulk-spec-vals">
                    {(valuesByAttr.get(specAttrId) ?? []).map((v) => (
                      <option key={v.id} value={v.value} />
                    ))}
                  </datalist>
                )}
              </label>
            )}
          </div>
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-card border-t border-foreground/10">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="btn btn-primary btn-md w-full disabled:opacity-50"
        >
          {isPending
            ? "Εφαρμογή…"
            : `Εφαρμογή σε ${affectedCount} προϊόντα`}
        </button>
      </div>
    </div>
  );
}

/* ── 3-state toggle (Άφησε / Ναι / Όχι) ───────────────────────────── */

function TriToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: TriState;
  onChange: (v: TriState) => void;
  ariaLabel: string;
}) {
  const opts: Array<{ k: TriState; label: string }> = [
    { k: "leave", label: "Άφησε" },
    { k: "yes", label: "Ναι" },
    { k: "no", label: "Όχι" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 rounded-md border border-foreground/20 overflow-hidden text-xs"
    >
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          role="radio"
          aria-checked={value === o.k}
          onClick={() => onChange(o.k)}
          className={`px-2.5 py-1.5 transition-colors ${
            value === o.k
              ? "bg-foreground text-background font-medium"
              : "bg-background text-muted-foreground hover:bg-foreground/5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
