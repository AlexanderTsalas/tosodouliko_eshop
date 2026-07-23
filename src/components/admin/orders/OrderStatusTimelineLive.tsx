"use client";

import { useEffect, useState } from "react";
import OrderStatusTimeline from "./OrderStatusTimeline";
import { orderStatusBus } from "@/lib/orders/statusBus";
import type { TimelinePresetName } from "@/config/status-timelines";
import type { CarrierSlug } from "@/config/carrier-slugs";

interface Props {
  orderId: string;
  carrierSlug: CarrierSlug | null;
  timelinePreset: TimelinePresetName | null;
  /** Server-rendered current status. Acts as the initial value AND the
   * canonical fallback after router.refresh() lands. */
  fulfillmentStatus: string;
}

/**
 * Client-side live wrapper around the otherwise-pure OrderStatusTimeline.
 *
 * Subscribes to the orderStatusBus so the timeline reflects the
 * admin's pick instantly — without waiting for the server action's
 * router.refresh (which takes 2-3s end-to-end). When the server
 * confirms, the new props sync down from the page render and replace
 * our optimistic value seamlessly (same value → no flicker). On
 * server error, the OrderStatusSelect publishes the previous value
 * to the bus, reverting us.
 *
 * Server stays the source of truth; this component is just an
 * accelerant for the visual reflection of admin intent.
 */
export default function OrderStatusTimelineLive({
  orderId,
  carrierSlug,
  timelinePreset,
  fulfillmentStatus,
}: Props) {
  // Locally track the optimistic status — initialized from the
  // server-rendered prop. Whenever the prop changes (router.refresh
  // landed with a new server value), we resync.
  const [localStatus, setLocalStatus] = useState(fulfillmentStatus);

  useEffect(() => {
    setLocalStatus(fulfillmentStatus);
  }, [fulfillmentStatus]);

  useEffect(() => {
    const unsubscribe = orderStatusBus.subscribe((event) => {
      // Filter to events for THIS order's fulfillment status only.
      // Payment status changes don't affect the fulfillment timeline.
      if (event.orderId !== orderId || event.kind !== "fulfillment") return;
      setLocalStatus(event.value);
    });
    return unsubscribe;
  }, [orderId]);

  return (
    <OrderStatusTimeline
      orderId={orderId}
      carrierSlug={carrierSlug}
      timelinePreset={timelinePreset}
      fulfillmentStatus={localStatus}
    />
  );
}
