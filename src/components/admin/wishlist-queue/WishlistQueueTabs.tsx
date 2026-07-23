"use client";

import { useState } from "react";
import WishlistQueueGroup, {
  type EnrichedPendingRow,
  type VariantInfo,
} from "./WishlistQueueGroup";
import WishlistSubscribersGroup, {
  type SubscriberRow,
  type SubscriberVariantInfo,
} from "./WishlistSubscribersGroup";

interface PendingGroup {
  info: VariantInfo;
  rows: EnrichedPendingRow[];
}

interface SubscriberGroup {
  info: SubscriberVariantInfo;
  rows: SubscriberRow[];
}

interface Props {
  pendingGroups: PendingGroup[];
  subscriberGroups: SubscriberGroup[];
}

/**
 * Two-pane client tab toggle for the admin "wishlist queue" page.
 *
 *   Εκκρεμείς   — dispatcher-decided pending_wishlist_notifications rows
 *                 (only populated when inventory returns AND mode='manual').
 *                 Action surface for notify/skip/bulk.
 *   Συνδρομητές — every wishlist_items row with notify_on_restock=true.
 *                 Read-only "who's waiting" view; useful while items are
 *                 out of stock.
 */
export default function WishlistQueueTabs({
  pendingGroups,
  subscriberGroups,
}: Props) {
  const [tab, setTab] = useState<"pending" | "subscribers">("pending");

  return (
    <div>
      <div className="cms-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pending"}
          aria-current={tab === "pending" ? "page" : undefined}
          onClick={() => setTab("pending")}
          className="cms-tab"
        >
          Εκκρεμείς ειδοποιήσεις
          <span className="cms-tab-count">{pendingGroups.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "subscribers"}
          aria-current={tab === "subscribers" ? "page" : undefined}
          onClick={() => setTab("subscribers")}
          className="cms-tab"
        >
          Συνδρομητές αναμονής
          <span className="cms-tab-count">{subscriberGroups.length}</span>
        </button>
      </div>

      <div className="pt-6">
        {tab === "pending" ? (
          pendingGroups.length === 0 ? (
            <div className="rounded border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              Δεν υπάρχουν εκκρεμείς ειδοποιήσεις λίστας αναμονής αυτή τη στιγμή.
            </div>
          ) : (
            <div className="space-y-4">
              {pendingGroups.map((g) => (
                <WishlistQueueGroup
                  key={g.info.variant_id}
                  variantInfo={g.info}
                  rows={g.rows}
                />
              ))}
            </div>
          )
        ) : subscriberGroups.length === 0 ? (
          <div className="rounded border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Δεν υπάρχουν συνδρομητές αναμονής για επιστροφή αποθέματος.
          </div>
        ) : (
          <div className="space-y-4">
            {subscriberGroups.map((g) => (
              <WishlistSubscribersGroup
                key={g.info.variant_id}
                variantInfo={g.info}
                rows={g.rows}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
