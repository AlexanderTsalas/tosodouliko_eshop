"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";
import type { Category } from "@/types/category-navigation";
import type { Supplier } from "@/types/suppliers";
import type { VatRate } from "@/types/vat-rates";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";

interface Props {
  filters: AdminProductFilterParams;
  categories: Pick<Category, "id" | "name">[];
  suppliers: Pick<Supplier, "id" | "name">[];
  vatRates: Pick<VatRate, "id" | "name" | "rate">[];
  attributes: Pick<Attribute, "slug" | "name">[];
  attributeValues?: Pick<AttributeValue, "id" | "value">[];
}

interface Chip {
  label: string;
  paramsToRemove: string[];
}

const NEG_OP_LABEL: Record<string, string> = {
  empty: "(κενό)",
  not_empty: "(οποιοδήποτε)",
};

export default function ProductsActiveFilterChips({
  filters,
  categories,
  suppliers,
  vatRates,
  attributes,
  attributeValues,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const valueLabelById = new Map((attributeValues ?? []).map((v) => [v.id, v.value]));

  const chips: Chip[] = [];

  if (filters.status) {
    chips.push({
      label: `Ορατότητα: ${filters.status === "active" ? "Ενεργά" : "Ανενεργά"}`,
      paramsToRemove: ["status"],
    });
  }
  if (filters.stock) {
    const stockLabels: Record<string, string> = { ok: "Διαθέσιμα", low: "Χαμηλό", out: "Άδεια" };
    chips.push({
      label: `Απόθεμα: ${stockLabels[filters.stock] ?? filters.stock}`,
      paramsToRemove: ["stock"],
    });
  }

  pushFkChip(
    chips,
    "Κατηγορία",
    filters.categoryId,
    filters.categoryIdOp,
    categories.map((c) => ({ id: c.id, name: c.name })),
    ["categoryId", "categoryIdOp"]
  );
  pushFkChip(
    chips,
    "Προμηθευτής",
    filters.supplierId,
    filters.supplierIdOp,
    suppliers.map((s) => ({ id: s.id, name: s.name })),
    ["supplierId", "supplierIdOp"]
  );
  pushFkChip(
    chips,
    "ΦΠΑ",
    filters.vatRateId,
    filters.vatRateIdOp,
    vatRates.map((r) => ({ id: r.id, name: `${r.name} (${(r.rate * 100).toFixed(0)}%)` })),
    ["vatRateId", "vatRateIdOp"]
  );

  if (filters.brandOp === "empty" || filters.brandOp === "not_empty") {
    chips.push({
      label: `Μάρκα ${NEG_OP_LABEL[filters.brandOp]}`,
      paramsToRemove: ["brand", "brandOp"],
    });
  } else if (filters.brand) {
    chips.push({ label: `Μάρκα: ${filters.brand}`, paramsToRemove: ["brand", "brandOp"] });
  }

  pushNumChip(chips, "Τιμή", "€", filters.priceOp, filters.minPrice, filters.maxPrice, [
    "minPrice",
    "maxPrice",
    "priceOp",
  ]);
  pushNumChip(chips, "Ηλικία", "έτη", filters.ageOp, filters.minAge, filters.maxAge, [
    "minAge",
    "maxAge",
    "ageOp",
  ]);
  pushNumChip(chips, "Βάρος", "g", filters.weightOp, filters.minWeight, filters.maxWeight, [
    "minWeight",
    "maxWeight",
    "weightOp",
  ]);
  pushNumChip(
    chips,
    "Κόστος",
    "",
    filters.costPriceOp,
    filters.minCostPrice,
    filters.maxCostPrice,
    ["minCostPrice", "maxCostPrice", "costPriceOp"]
  );

  if (filters.attributeFilters) {
    for (const [slug, valueIds] of Object.entries(filters.attributeFilters)) {
      const attr = attributes.find((a) => a.slug === slug);
      const labels = valueIds.map((id) => valueLabelById.get(id) ?? id);
      chips.push({
        label: `${attr?.name ?? slug}: ${labels.join(", ")}`,
        paramsToRemove: [`attr_${slug}`],
      });
    }
  }

  if (chips.length === 0) return null;

  function dismiss(paramsToRemove: string[]) {
    const next = new URLSearchParams(searchParams.toString());
    for (const k of paramsToRemove) next.delete(k);
    next.delete("page");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function clearAll() {
    const next = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) next.set("q", q);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      {chips.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => dismiss(c.paramsToRemove)}
          className="flex items-center gap-1 rounded bg-primary/10 text-primary px-2 py-0.5 hover:bg-primary/20"
        >
          <span>{c.label}</span>
          <span aria-hidden className="opacity-50">×</span>
        </button>
      ))}
      <button type="button" onClick={clearAll} className="text-muted-foreground underline ml-1">
        Καθαρισμός όλων
      </button>
    </div>
  );
}

function pushFkChip(
  chips: Chip[],
  label: string,
  value: string | undefined,
  op: string | undefined,
  options: Array<{ id: string; name: string }>,
  paramsToRemove: string[]
) {
  if (op === "empty" || op === "not_empty") {
    chips.push({ label: `${label} ${NEG_OP_LABEL[op]}`, paramsToRemove });
  } else if (value) {
    const o = options.find((x) => x.id === value);
    chips.push({ label: `${label}: ${o?.name ?? value}`, paramsToRemove });
  }
}

function pushNumChip(
  chips: Chip[],
  label: string,
  unit: string,
  op: string | undefined,
  min: string | undefined,
  max: string | undefined,
  paramsToRemove: string[]
) {
  if (op === "empty" || op === "not_empty") {
    chips.push({ label: `${label} ${NEG_OP_LABEL[op]}`, paramsToRemove });
  } else if (min || max) {
    chips.push({
      label: `${label}: ${min || "—"} – ${max || "—"}${unit ? " " + unit : ""}`,
      paramsToRemove,
    });
  }
}
