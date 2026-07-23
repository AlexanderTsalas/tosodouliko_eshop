import type { Supplier, SupplyOrderLine } from "@/types/suppliers";

/**
 * Build a CSV string for a supplier draft. Works equally well for placed
 * orders. CSV is universally importable into Excel and Google Sheets, so
 * we ship this single format in H1; richer XLSX/PDF export is H2 work
 * if/when a supplier specifically demands it.
 */
export function buildDraftCsv(
  supplier: Supplier,
  lines: SupplyOrderLine[]
): string {
  const rows: string[][] = [
    [
      "Business SKU",
      "Supplier SKU",
      "Product",
      "Ordered Qty",
      "Unit Cost",
      "Currency",
      "Line Total",
      "Notes",
    ],
  ];

  for (const l of lines) {
    const lineTotal = (Number(l.unit_cost) || 0) * l.ordered_qty;
    rows.push([
      l.business_sku_at_draft,
      l.supplier_sku_at_draft ?? "",
      l.variant_label ?? "",
      String(l.ordered_qty),
      l.unit_cost !== null ? String(l.unit_cost) : "",
      l.unit_cost_currency ?? supplier.default_currency,
      lineTotal.toFixed(2),
      l.notes ?? "",
    ]);
  }

  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function csvCell(v: string): string {
  if (v === "") return "";
  // Quote fields that contain commas, double-quotes, or newlines; escape
  // embedded quotes by doubling.
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** Filename suggestion for a supplier export, e.g. "supplier-acme-2026-05-17.csv". */
export function suggestCsvFilename(supplier: Supplier): string {
  const slug = supplier.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `supplier-${slug || supplier.id}-${date}.csv`;
}

/**
 * Builds a `mailto:` URL with the supplier's address as recipient and a
 * prefilled body listing the draft lines. The CSV itself can't be attached
 * via mailto (browsers don't support attachments in mailto links), so the
 * admin downloads the CSV separately and attaches it in their mail client.
 */
export function buildMailtoUrl(
  supplier: Supplier,
  lines: SupplyOrderLine[]
): string {
  const subject = `Παραγγελία προμηθειών — ${supplier.name}`;
  const lineSummary = lines
    .map(
      (l) =>
        `- ${l.business_sku_at_draft}${l.supplier_sku_at_draft ? ` / ${l.supplier_sku_at_draft}` : ""}: ${l.ordered_qty} τμχ`
    )
    .join("\n");
  const body = `Καλησπέρα,

Σας παραθέτουμε την παρακάτω παραγγελία:

${lineSummary}

Επισυνάπτω και το CSV.

Ευχαριστούμε.`;
  const to = supplier.primary_email ?? "";
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
