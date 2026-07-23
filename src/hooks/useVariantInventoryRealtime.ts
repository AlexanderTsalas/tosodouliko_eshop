"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface Options {
  /**
   * Variant IDs to listen for. The Postgres realtime filter uses
   * `variant_id=in.(...)` so we only get callbacks for relevant rows.
   */
  variantIds: string[];
  /**
   * Called on any INSERT/UPDATE to inventory_items for one of the watched
   * variants. The consumer typically debounces a refetch of
   * `effective_available_for` to repaint CTAs.
   */
  onChange: () => void;
}

/**
 * Phase 4D: subscribes the product page to Supabase Realtime CDC on
 * inventory_items rows for a fixed set of variant IDs (all variants of
 * the currently-viewed product). When any of their counters move
 * (quantity_available, quantity_soft_held, quantity_priority_held,
 * quantity_reserved), the consumer refetches effective_available_for
 * and updates the CTA between "Add to Cart" and "Notify me when available"
 * — no page refresh required.
 *
 * Public-read RLS on inventory_items means anonymous browsers also get
 * the live events.
 */
export function useVariantInventoryRealtime({
  variantIds,
  onChange,
}: Options) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Stable key for the variant set so the subscription only rebuilds when
  // the actual list changes (not on every parent re-render).
  const variantKey = variantIds.slice().sort().join(",");

  useEffect(() => {
    if (variantIds.length === 0) return;
    const supabase = createClient();
    const filter = `variant_id=in.(${variantIds.join(",")})`;

    // Backfill: fire onChange once on mount so the consumer fetches current
    // inventory immediately. This closes the gap between ISR cache generation
    // and Realtime subscription start — if inventory changed after the cache
    // was built but before we subscribed, the backfill catches it. Without
    // this, the page would show stale "in stock" from the cache until the
    // next Realtime event or ISR revalidation.
    onChangeRef.current();

    const channel = supabase
      .channel(`variant-inventory-${variantKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_items", filter },
        () => onChangeRef.current()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // variantKey covers identity; eslint can't see that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantKey]);
}
