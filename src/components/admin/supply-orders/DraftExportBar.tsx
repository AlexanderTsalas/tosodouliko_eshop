"use client";

import { buildDraftCsv, buildMailtoUrl, suggestCsvFilename } from "@/lib/supply-orders/exportCsv";
import type { Supplier, SupplyOrderLine } from "@/types/suppliers";

interface Props {
  supplier: Supplier;
  lines: SupplyOrderLine[];
}

export default function DraftExportBar({ supplier, lines }: Props) {
  function handleDownload() {
    const csv = buildDraftCsv(supplier, lines);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestCsvFilename(supplier);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (lines.length === 0) return null;
  const mailto = buildMailtoUrl(supplier, lines);
  const canEmail = !!supplier.primary_email;
  const canCall = !!supplier.primary_phone;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleDownload}
        className="btn btn-secondary btn-sm"
      >
        Export CSV
      </button>
      <a
        href={mailto}
        target="_blank"
        rel="noopener noreferrer"
        className={`btn btn-secondary btn-sm ${
          canEmail ? "" : "opacity-50 pointer-events-none"
        }`}
      >
        Email προμηθευτή
      </a>
      {canCall && (
        <a
          href={`tel:${supplier.primary_phone}`}
          className="btn btn-secondary btn-sm font-mono"
        >
          {supplier.primary_phone}
        </a>
      )}
    </div>
  );
}
