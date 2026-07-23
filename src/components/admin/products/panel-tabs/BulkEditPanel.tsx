"use client";

import { useEffect, useState } from "react";
import { getBulkEditData } from "@/actions/products/getBulkEditData";
import { X } from "@/components/admin/common/icons";
import TabLoading from "./TabLoading";
import BulkOverviewForm from "./BulkOverviewForm";
import BulkCustomFieldsSection from "./BulkCustomFieldsSection";
import BulkVariantAxisSection from "./BulkVariantAxisSection";
import type { BulkSelection } from "@/components/admin/products/PanelControllerContext";

type BulkTab = "overview" | "variants" | "fields";

/**
 * Bulk-edit mode for the panel. Wears the SAME tab shell as the
 * single-product panel — Επισκόπηση / Παραλλαγές / Πεδία — so bulk feels
 * like the normal editor rather than a separate generic form. Tabs that
 * have no cross-product meaning (Images / SEO / Σχετικά) are omitted.
 *
 * Replaces the standalone /admin/products/bulk-edit route — the
 * "Επεξεργασία επιλεγμένων" CTA opens this.
 */
export default function BulkEditPanel({
  selection,
  onClose,
}: {
  selection: BulkSelection;
  onClose: () => void;
}) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getBulkEditData>
  > | null>(null);
  const [tab, setTab] = useState<BulkTab>("overview");

  useEffect(() => {
    let alive = true;
    getBulkEditData(selection)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selection]);

  const countLabel = selection.matchAll
    ? "Όλα τα προϊόντα που ταιριάζουν στα φίλτρα"
    : `${selection.selectedIds.length} επιλεγμένα προϊόντα`;

  return (
    <div className="flex flex-col h-full">
      <header className="px-5 pt-5 pb-3 border-b border-foreground/10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">
            Ομαδική επεξεργασία
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {countLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className="p-1.5 rounded-sm hover:bg-foreground/5 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Same tab bar as the single-product panel. */}
      <div className="px-5 border-b border-foreground/10 flex gap-0 overflow-x-auto">
        <BulkTabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Επισκόπηση
        </BulkTabButton>
        <BulkTabButton active={tab === "variants"} onClick={() => setTab("variants")}>
          Παραλλαγές
        </BulkTabButton>
        <BulkTabButton active={tab === "fields"} onClick={() => setTab("fields")}>
          Πεδία
        </BulkTabButton>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!data ? (
          <TabLoading />
        ) : !data.ok ? (
          <p
            role="alert"
            className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {data.error}
          </p>
        ) : tab === "overview" ? (
          <BulkOverviewForm
            productIds={data.productIds}
            matchAll={data.matchAll}
            filterParams={data.filterParams}
            affectedCount={data.affectedCount}
            vatRates={data.vatRates}
            suppliers={data.suppliers}
            categories={data.categories}
            attributes={data.attributes}
            attributeValues={data.attributeValues}
            volumetricPrefixes={data.volumetricPrefixes}
          />
        ) : tab === "variants" ? (
          <BulkVariantAxisSection
            productIds={data.productIds}
            attributes={data.attributes}
            attributeValues={data.attributeValues}
          />
        ) : (
          <BulkCustomFieldsSection
            productIds={data.productIds}
            affectedCount={data.affectedCount}
          />
        )}
      </div>
    </div>
  );
}

/* ── Tab button — mirrors the single-product panel's TabButton. ────── */

function BulkTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-3 py-2.5 text-sm shrink-0 whitespace-nowrap
        border-b-2 transition-colors
        ${
          active
            ? "border-terracotta text-foreground font-medium"
            : "border-transparent text-muted-foreground hover:text-foreground"
        }
      `}
    >
      {children}
    </button>
  );
}
