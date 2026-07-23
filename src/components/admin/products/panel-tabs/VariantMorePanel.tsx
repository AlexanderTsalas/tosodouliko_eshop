"use client";

import { useCallback, useEffect, useState } from "react";
import { getVariantExtras } from "@/actions/variants/getVariantExtras";
import { updateVariant } from "@/actions/variants/updateVariant";
import VariantSuppliersPanel from "@/components/admin/variants/VariantSuppliersPanel";
import Toggle from "@/components/admin/common/Toggle";
import TabLoading from "./TabLoading";

/**
 * Expanded ("more") section of a variant card. Lazy-loads the variant's
 * extended data (suppliers, OOS-visibility override, track-supply) only
 * when the admin expands it, and hosts the existing VariantSuppliersPanel
 * plus compact controls for the two extra fields.
 */
export default function VariantMorePanel({ variantId }: { variantId: string }) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getVariantExtras>
  > | null>(null);
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    getVariantExtras(variantId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [variantId, nonce]);

  // Local optimistic state for the two scalar fields, seeded from the fetch.
  const [showWhenOos, setShowWhenOos] = useState<boolean | null>(null);
  const [trackSupply, setTrackSupply] = useState(true);
  useEffect(() => {
    if (data) {
      setShowWhenOos(data.showWhenOos);
      setTrackSupply(data.trackSupply);
    }
  }, [data]);

  if (!data) return <TabLoading />;

  function changeShowWhenOos(raw: string) {
    const next = raw === "true" ? true : raw === "false" ? false : null;
    const prev = showWhenOos;
    setShowWhenOos(next);
    void updateVariant({ id: variantId, showWhenOos: next }).then((r) => {
      if (!r.success) setShowWhenOos(prev);
    });
  }

  function changeTrackSupply(next: boolean) {
    const prev = trackSupply;
    setTrackSupply(next);
    void updateVariant({ id: variantId, trackSupply: next }).then((r) => {
      if (!r.success) setTrackSupply(prev);
    });
  }

  return (
    <div className="mt-2 pt-2 border-t border-foreground/10 space-y-3">
      {/* OOS visibility + track-supply */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Ορατότητα (OOS)</span>
          <select
            value={
              showWhenOos === null ? "" : showWhenOos ? "true" : "false"
            }
            onChange={(e) => changeShowWhenOos(e.target.value)}
            className="rounded-sm border border-foreground/30 bg-background px-1.5 py-0.5 text-xs"
            aria-label="Ορατότητα όταν εξαντλείται"
          >
            <option value="">
              Κληρονομικό ({data.inheritedShowWhenOos ? "Ορατή" : "Κρυφή"})
            </option>
            <option value="true">Πάντα ορατή</option>
            <option value="false">Κρυφή όταν OOS</option>
          </select>
        </label>
        <span className="inline-flex items-center gap-1.5">
          <Toggle
            checked={trackSupply}
            onChange={changeTrackSupply}
            ariaLabel="Παρακολούθηση προμήθειας"
            size="sm"
          />
          <span className="text-muted-foreground">Παρακολούθηση προμήθειας</span>
        </span>
      </div>

      {/* Suppliers — onRefetch re-runs getVariantExtras so an added row
          gets its proper composed cost shape. */}
      <VariantSuppliersPanel
        variantId={variantId}
        initial={data.suppliers}
        allSuppliers={data.allSuppliers}
        onRefetch={refetch}
      />
    </div>
  );
}
