"use client";

/**
 * Tiny client-side pub/sub for order-status changes.
 *
 * Why: the admin order page has the status DROPDOWN (OrderStatusSelect)
 * and the timeline GRAPH (OrderStatusTimeline) sitting in different
 * column/section subtrees of the same page. When the dropdown fires a
 * transition, the timeline takes 2-3s to update because it relies on
 * the server-action's `router.refresh()` re-render. That stutter feels
 * broken to the operator who just clicked.
 *
 * The bus lets the dropdown publish the new status the instant the
 * admin picks it; the timeline subscribes and updates locally before
 * the server roundtrip completes. On server error, the dropdown
 * publishes the previous value to revert the timeline.
 *
 * Scope: per-order (keyed by orderId + kind so a future multi-order
 * page wouldn't cross-publish). Subscribers receive only events for
 * their orderId+kind pair.
 *
 * No global store / context provider is needed — this is a tiny
 * in-memory bus that lives for the lifetime of the page module. The
 * server stays the source of truth; this is purely a UX accelerant.
 */

type StatusKind = "fulfillment" | "payment";

interface StatusEvent {
  orderId: string;
  kind: StatusKind;
  value: string;
}

type Listener = (event: StatusEvent) => void;

const listeners = new Set<Listener>();

export const orderStatusBus = {
  /** Publish a new optimistic status. Called by OrderStatusSelect. */
  publish(event: StatusEvent) {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        // A faulty listener shouldn't break the publisher. Surface to
        // console for debugging; production traffic continues normally.
        console.error("[orderStatusBus] listener threw:", err);
      }
    }
  },
  /** Subscribe to status events. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export type { StatusEvent, StatusKind };
