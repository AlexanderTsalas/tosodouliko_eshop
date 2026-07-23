"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionOrderStatus } from "@/actions/orders/transitionOrderStatus";
import type { StatusCode } from "@/config/status-vocabulary";
import { STATUS_LABELS } from "@/config/status-vocabulary";

/**
 * Maps a 18-value StatusCode to the 9-value FulfillmentStatus enum
 * transitionOrderStatus currently accepts. Returns null for codes the
 * action can't yet persist — those nodes render informationally only.
 *
 * Aligning the action + storefront FulfillmentStatus + DB enum to the
 * full StatusCode vocabulary is a separate cleanup ticket.
 */
function legacyOf(code: StatusCode): LegacyFulfillment | null {
  switch (code) {
    case "draft":
    case "pending":
    case "confirmed":
    case "preparing":
    case "delivered":
    case "cancelled":
      return code;
    case "in_transit":
      return "shipped";
    case "arrived_at_pickup":
      return "ready_for_pickup";
    case "collected":
      return "picked_up";
    default:
      return null;
  }
}

type LegacyFulfillment =
  | "draft"
  | "pending"
  | "confirmed"
  | "preparing"
  | "shipped"
  | "ready_for_pickup"
  | "delivered"
  | "picked_up"
  | "cancelled";

export type TimelineNodeState =
  | "completed"
  | "active"
  | "pending"
  | "latent"
  | "active-exception";

interface Props {
  orderId: string;
  code: StatusCode;
  state: TimelineNodeState;
  /** Visual variant — drives shape. */
  variant: "main" | "recoverable" | "terminal";
  /** Size of the node (px diameter). Default 16. */
  size?: number;
}

/**
 * The bare clickable node — no label. Layout/positioning belongs to the
 * parent OrderStatusTimeline component (which now uses absolute SVG-based
 * positioning rather than flow layout).
 *
 * Click semantics:
 *   - Non-destructive transitions: commit on first click
 *   - Destructive transitions (cancelled / returning / returned / lost):
 *     two-click pattern — first click visually arms the node (red glow),
 *     second commits
 *   - Inert when the StatusCode has no legacy FulfillmentStatus mapping
 */
export default function OrderStatusTimelineNode({
  orderId,
  code,
  state,
  variant,
  size = 16,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const legacy = legacyOf(code);
  const clickable =
    legacy !== null && state !== "active" && state !== "active-exception";
  const isDestructive =
    code === "cancelled" ||
    code === "returning" ||
    code === "returned" ||
    code === "lost";

  const label = STATUS_LABELS[code]?.admin ?? code;

  function commit() {
    if (!legacy) return;
    setError(null);
    setArmed(false);
    startTransition(async () => {
      const res = await transitionOrderStatus({
        orderId,
        fulfillment_status: legacy,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleClick() {
    if (!clickable || isPending) return;
    if (isDestructive && !armed) {
      setArmed(true);
      return;
    }
    commit();
  }

  // Shape by variant — main is a circle; recoverable is a rounded square;
  // terminal is a hex (clipped polygon).
  const baseShape =
    variant === "main"
      ? "rounded-full"
      : variant === "recoverable"
        ? "rounded-md"
        : "[clip-path:polygon(20%_0,80%_0,100%_50%,80%_100%,20%_100%,0_50%)]";

  const fill =
    state === "completed"
      ? "bg-primary border-primary"
      : state === "active"
        ? "bg-primary border-primary ring-4 ring-primary/30 animate-pulse"
        : state === "active-exception"
          ? variant === "recoverable"
            ? "bg-amber-500 border-amber-500 ring-4 ring-amber-300/40 animate-pulse"
            : "bg-destructive border-destructive ring-4 ring-destructive/30 animate-pulse"
          : state === "pending"
            ? "bg-background border-2 border-muted-foreground/40"
            : "bg-background border-2 border-muted-foreground/20"; // latent

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!clickable || isPending}
      aria-label={label}
      title={
        !clickable && legacy === null
          ? `${label} — δεν είναι ακόμη διαθέσιμη μετάβαση από εδώ`
          : armed
            ? "Πατήστε ξανά για επιβεβαίωση"
            : label
      }
      style={{ width: size, height: size }}
      className={[
        "block border transition-shadow",
        baseShape,
        fill,
        clickable
          ? "cursor-pointer hover:scale-110 hover:shadow-md"
          : "cursor-default",
        isPending ? "opacity-50" : "",
        armed ? "ring-4 ring-destructive/60" : "",
        error ? "ring-2 ring-destructive" : "",
      ].join(" ")}
    />
  );
}

/**
 * Helper exposed for the parent to know whether a transition is supported
 * (for cursor styling, tooltip text, etc.) without re-importing the
 * mapping logic.
 */
export function canTransitionTo(code: StatusCode): boolean {
  return legacyOf(code) !== null;
}
