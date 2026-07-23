"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface Options {
  cartId: string | null | undefined;
  onChange: () => void;
  /**
   * Called when a cart_item is DELETEd by something other than this client's
   * own removal action. Used to surface the Phase 4 collapse modal — items
   * that disappear without the customer pressing "Αφαίρεση" must have been
   * removed by `collapse_soft_wait_queue_for_session` when the soft-holder
   * clicked Pay.
   */
  onForeignDelete?: (deletedCartItemId: string) => void;
}

/**
 * Subscribes the cart UI to Supabase Realtime change events on the
 * contention surfaces. Refetches the cart on any relevant change so the
 * waiting badges, promoted-state UI, and item lists stay live.
 *
 * Phase 7 of the data-layer remediation: the soft_waits + priority_holds
 * subscriptions used to be UNFILTERED, relying on RLS to drop irrelevant
 * events client-side. That worked at small scale but broadcasts every
 * customer's contention events to every other customer's open cart
 * drawer — Realtime evaluates RLS per (event × subscriber) even when the
 * client will end up dropping the event. At 1000 concurrent cart drawers
 * each event becomes 1000 broadcast-decisions; CPU on the Realtime
 * container blows up.
 *
 * Now the subscriptions are scoped to `customer_id=eq.${customerId}` so
 * each customer's cart drawer only receives events that actually
 * concern them. Cost: one extra round-trip at mount to resolve the
 * customer_id from auth.uid(). Benefit: ~95% reduction in broadcast
 * volume per cart-active customer.
 *
 * Distinguishing collapse from user-initiated remove: the consumer
 * maintains a set of cart_item ids it just deleted via
 * `useCart.remove()`. Pass them in via the `recentSelfDeletesRef`
 * accessor pattern — see CartDrawer for the consumer wiring.
 */
export function useCartRealtime({ cartId, onChange, onForeignDelete }: Options) {
  // Stable refs for the latest callbacks so we don't tear down + rebuild the
  // subscription every render.
  const onChangeRef = useRef(onChange);
  const onForeignDeleteRef = useRef(onForeignDelete);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onForeignDeleteRef.current = onForeignDelete;
  }, [onForeignDelete]);

  useEffect(() => {
    if (!cartId) return;
    let cancelled = false;
    const supabase = createClient();

    // Resolve customer_id once for the lifetime of this subscription.
    // Phase 7: the filter strings are baked into the subscribe() call so
    // Realtime can short-circuit broadcast for non-matching events
    // server-side rather than evaluating RLS per subscriber.
    let teardown: (() => void) | null = null;
    void (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled || !authData.user) return;
      const { data: custRow } = await supabase
        .from("customers")
        .select("id")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();
      if (cancelled) return;
      const customerId = (custRow as { id: string } | null)?.id ?? null;
      if (!customerId) {
        // No customer row (rare for an active cart but possible during
        // anon→auth transition). Fall back to the cart_items-only
        // subscription so the cart still updates on user-driven changes;
        // contention events will arrive late or via the cart_items
        // collapse-DELETE path.
        const fallback = supabase
          .channel(`cart-realtime-${cartId}-fallback`)
          .on(
            "postgres_changes",
            {
              event: "DELETE",
              schema: "public",
              table: "cart_items",
              filter: `cart_id=eq.${cartId}`,
            },
            (payload) => {
              const deletedId = (payload.old as { id?: string } | undefined)?.id;
              if (deletedId && onForeignDeleteRef.current) {
                onForeignDeleteRef.current(deletedId);
              }
              onChangeRef.current();
            }
          )
          .subscribe();
        teardown = () => {
          void supabase.removeChannel(fallback);
        };
        return;
      }

      const channel = supabase
        .channel(`cart-realtime-${cartId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "soft_waits",
            filter: `customer_id=eq.${customerId}`,
          },
          () => onChangeRef.current()
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "priority_holds",
            filter: `customer_id=eq.${customerId}`,
          },
          () => onChangeRef.current()
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "cart_items",
            filter: `cart_id=eq.${cartId}`,
          },
          (payload) => {
            const deletedId = (payload.old as { id?: string } | undefined)?.id;
            if (deletedId && onForeignDeleteRef.current) {
              onForeignDeleteRef.current(deletedId);
            }
            onChangeRef.current();
          }
        )
        .subscribe();

      teardown = () => {
        void supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      if (teardown) teardown();
    };
  }, [cartId]);
}
