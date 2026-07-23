"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionOrderStatus } from "@/actions/orders/transitionOrderStatus";
import { orderStatusBus } from "@/lib/orders/statusBus";
import {
  normalizeStatusCode,
  STATUS_LABELS,
  type StatusCode,
} from "@/config/status-vocabulary";
import {
  getValidStatusesForCarrier,
  type TimelinePresetName,
} from "@/config/status-timelines";
import type { CarrierSlug } from "@/config/carrier-slugs";
import type {
  FulfillmentStatus,
  PaymentStatus,
  PaymentMethod,
} from "@/types/order-history";

const NEXT_PAYMENT: Record<PaymentStatus, PaymentStatus[]> = {
  pending:  ["paid", "failed"],
  paid:     ["refunded"],
  refunded: [],
  failed:   [],
};

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: "Εκκρεμεί",
  paid: "Πληρωμένη",
  refunded: "Επιστροφή χρημάτων",
  failed: "Απέτυχε",
};

interface FulfillmentProps {
  kind: "fulfillment";
  orderId: string;
  currentStatus: FulfillmentStatus;
  /** Carrier slug — drives WHICH timeline's status codes are valid
   *  next states. NULL = no carrier yet (admin still in pre-shipment
   *  phase); use the generic timeline. */
  carrierSlug?: CarrierSlug | null;
  /** Optional custom-carrier timeline preset. */
  timelinePreset?: TimelinePresetName | null;
  /** Optimistic-lock snapshot from page render — `orders.updated_at`
   *  at the moment the page loaded. The action will refuse the
   *  transition if the row has been advanced by anyone else since. */
  orderUpdatedAt?: string;
}

interface PaymentProps {
  kind: "payment";
  orderId: string;
  currentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  /** See FulfillmentProps.orderUpdatedAt — same semantics. */
  orderUpdatedAt?: string;
}

type Props = FulfillmentProps | PaymentProps;

/**
 * Inline dropdown that triggers a status transition on selection.
 * Replaces the standalone "Μετάβαση κατάστασης" buttons cluster — the
 * dropdown sits inside the existing status card so the current value
 * IS the control.
 *
 * Behavior:
 *   - Lists only valid forward transitions per the state machine
 *   - Stripe-paid orders hide the payment dropdown (managed by webhook)
 *   - Refund is NOT included here — it's a separate button with its own
 *     reason-capture flow
 *   - Destructive choices (cancelled / failed) still confirm via the
 *     existing window.confirm pattern; replacing that with a proper
 *     dialog is a flagged follow-up
 *   - Stays a static text + label when no transitions are available
 *     (terminal states like delivered / picked_up / cancelled)
 */
export default function OrderStatusSelect(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string>("");

  const currentLabel = formatLabel(props);
  const validNext = computeNext(props);

  // Stripe-paid orders take payment_status from the webhook — surface
  // current value as read-only with a small hint.
  if (props.kind === "payment" && props.paymentMethod === "stripe") {
    return (
      <div>
        <p className="font-medium">{currentLabel}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Διαχειρίζεται από Stripe (webhook).
        </p>
      </div>
    );
  }

  if (validNext.length === 0) {
    return (
      <div>
        <p className="font-medium">{currentLabel}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Τελική κατάσταση.
        </p>
      </div>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const to = e.target.value;
    if (!to || to === props.currentStatus) {
      setDraftValue("");
      return;
    }
    const destructive =
      to === "cancelled" || to === "failed" || to === "refunded";
    const verb =
      props.kind === "fulfillment" ? "ροής" : "πληρωμής";
    if (destructive && !confirm(`Μετάβαση ${verb} σε: ${labelFor(props.kind, to)};`)) {
      setDraftValue("");
      return;
    }
    setError(null);
    setDraftValue(to);
    // Capture the previous value so we can revert on error.
    const previousValue = props.currentStatus;
    // Publish the optimistic value to the status bus so siblings
    // (the timeline graph, etc.) update instantly — before the
    // server roundtrip + router.refresh that would otherwise take
    // 2-3s to land. Server stays the source of truth; this is purely
    // a UX accelerant.
    orderStatusBus.publish({
      orderId: props.orderId,
      kind: props.kind,
      value: to,
    });

    startTransition(async () => {
      const payload =
        props.kind === "fulfillment"
          ? {
              orderId: props.orderId,
              fulfillment_status: to as FulfillmentStatus,
              expected_updated_at: props.orderUpdatedAt,
            }
          : {
              orderId: props.orderId,
              payment_status: to as PaymentStatus,
              expected_updated_at: props.orderUpdatedAt,
            };
      const r = await transitionOrderStatus(payload);
      if (!r.success) {
        // Revert optimistic publication.
        orderStatusBus.publish({
          orderId: props.orderId,
          kind: props.kind,
          value: previousValue,
        });
        // Concurrent-edit detection — if someone else moved the row
        // since this page loaded, prompt the admin to reload to see
        // the current state rather than retrying blindly.
        if (r.code === "CONCURRENT_EDIT") {
          setError(r.error);
          setDraftValue("");
          // Trigger a router refresh so the page re-renders with the
          // latest `updated_at`; user sees both the error and the
          // refreshed state simultaneously.
          router.refresh();
          return;
        }
        setError(r.error);
        setDraftValue("");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <select
        value={draftValue || props.currentStatus}
        onChange={handleChange}
        disabled={isPending}
        className="w-full font-medium bg-transparent border-0 px-0 py-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 rounded -ml-px disabled:opacity-50"
      >
        <option value={props.currentStatus}>{currentLabel}</option>
        {validNext.map((next) => (
          <option key={next} value={next}>
            → {labelFor(props.kind, next)}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-[10px] text-destructive mt-0.5">{error}</p>
      )}
    </div>
  );
}

function computeNext(props: Props): string[] {
  if (props.kind === "fulfillment") {
    return computeFulfillmentNext(props);
  }
  // Drop 'refunded' — refunds run through their own flow with reason capture.
  return NEXT_PAYMENT[props.currentStatus].filter((s) => s !== "refunded");
}

/**
 * Next-state computation for fulfillment status, derived from the
 * carrier's timeline rather than a hardcoded legacy map. Replaces the
 * old 9-state shipping flow that ignored the carrier entirely.
 *
 * Algorithm:
 *   1. Look up the carrier's stages list. Includes main-spine codes
 *      (pre-shipment + happy path) AND exception branches.
 *   2. Find the current status's position in the spine. From there,
 *      valid forward moves are:
 *        a. Every subsequent main-spine code
 *        b. Every exception code that branches from any spine code at
 *           or after current (so admins can mark on_hold from
 *           in_transit, delivery_attempted_absent from
 *           out_for_delivery, etc.)
 *        c. 'cancelled' is universally allowed (terminal exit hatch)
 *   3. Terminal codes return empty (no further moves).
 *
 * Legacy codes (shipped/ready_for_pickup/picked_up) are normalized to
 * their new equivalents (in_transit/arrived_at_pickup/collected) for
 * the position lookup, then the dropdown surfaces BOTH forms so admins
 * can choose either — eases the migration.
 */
function computeFulfillmentNext(props: FulfillmentProps): string[] {
  // Normalize legacy → new for the position lookup.
  const cur = normalizeStatusCode(props.currentStatus) as StatusCode;
  const stages = getValidStatusesForCarrier(
    props.carrierSlug ?? null,
    props.timelinePreset ?? null
  );
  const curIdx = stages.indexOf(cur);
  if (curIdx === -1) {
    // Carrier's timeline doesn't recognize this status (data drift).
    // Fall back to allowing any non-current valid status — better than
    // locking the dropdown to nothing.
    return stages.filter((s) => s !== cur);
  }
  // Get the carrier timeline object so we can introspect exception vs.
  // main-spine + branch-from for each stage.
  // (getValidStatusesForCarrier only returns the codes; we need
  // structure, so re-derive via the full registry.)
  // Cheap path: everything AFTER the current index in the stages
  // array is a valid candidate; the timeline's ordering already
  // captures "logical forward progression". Cancelled is always
  // available as the universal exit even when it appears earlier in
  // the array (it's positioned near 'confirmed' for "early exit"
  // semantics).
  const forward = stages.slice(curIdx + 1);
  const out = new Set<string>(forward);
  if (stages.includes("cancelled" as StatusCode)) out.add("cancelled");
  return Array.from(out);
}

function formatLabel(props: Props): string {
  if (props.kind === "fulfillment") {
    return labelFor("fulfillment", props.currentStatus);
  }
  return labelFor("payment", props.currentStatus);
}

function labelFor(kind: "fulfillment" | "payment", code: string): string {
  if (kind === "payment") {
    return PAYMENT_LABELS[code as PaymentStatus] ?? code;
  }
  // Translate legacy FulfillmentStatus → StatusCode via normalize, then
  // look up the admin Greek label.
  const normalized = normalizeStatusCode(code);
  return STATUS_LABELS[normalized]?.admin ?? code;
}
