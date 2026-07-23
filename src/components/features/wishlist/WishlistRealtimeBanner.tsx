"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  customerId: string;
}

interface Notification {
  id: number;
  product_name: string;
  product_url: string;
  hold_expires_at: string;
}

/**
 * Phase 6.5 — listens to the customer's broadcast channel for
 * `wishlist_notification_fired` events. When one arrives, shows a banner
 * at the top of the page with the product name and a live countdown to
 * the 30-min priority hold expiry. Calls router.refresh() so the
 * underlying wishlist items list repaints with the new
 * `last_notified_at` + cleared `notify_on_restock` state.
 *
 * Multiple notifications stack — newer banners appear on top, can be
 * dismissed independently.
 */
export default function WishlistRealtimeBanner({ customerId }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const idCounterRef = useRef(0);

  useEffect(() => {
    const supabase = createClient();
    // Phase 10 H2: subscribe with `private: true` so the channel routes
    // through Realtime Authorization. The RLS policy on
    // `realtime.messages` restricts reads to the customer whose JWT sub
    // resolves to this customer_id — other authenticated users get nothing.
    const channel = supabase
      .channel(`customer:${customerId}`, { config: { private: true } })
      .on(
        "broadcast",
        { event: "wishlist_notification_fired" },
        (msg) => {
          const payload = (msg.payload ?? {}) as {
            product_name?: string;
            product_url?: string;
            hold_expires_at?: string;
          };
          if (!payload.product_name || !payload.hold_expires_at) return;
          idCounterRef.current += 1;
          setNotifications((prev) => [
            {
              id: idCounterRef.current,
              product_name: payload.product_name as string,
              product_url: payload.product_url ?? "/wishlist",
              hold_expires_at: payload.hold_expires_at as string,
            },
            ...prev,
          ]);
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [customerId, router]);

  if (notifications.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {notifications.map((n) => (
        <NotificationCard
          key={n.id}
          notification={n}
          onDismiss={() =>
            setNotifications((prev) => prev.filter((p) => p.id !== n.id))
          }
        />
      ))}
    </div>
  );
}

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  const expiresMs = new Date(notification.hold_expires_at).getTime();
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, expiresMs - Date.now())
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresMs]);

  // Auto-dismiss when the hold has fully expired — at that point the
  // banner is misleading.
  useEffect(() => {
    if (remainingMs <= 0) {
      const id = window.setTimeout(onDismiss, 1500);
      return () => window.clearTimeout(id);
    }
  }, [remainingMs, onDismiss]);

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-start gap-3"
    >
      <span aria-hidden="true">📦</span>
      <div className="flex-1">
        <p className="font-medium">
          Καλά νέα — το «{notification.product_name}» επέστρεψε σε απόθεμα.
        </p>
        <p className="mt-1 text-emerald-800">
          Έχετε αποκλειστική προτεραιότητα για{" "}
          <span className="font-mono font-semibold">
            {mm}:{ss.toString().padStart(2, "0")}
          </span>
          .{" "}
          <a
            href={notification.product_url}
            className="font-medium underline"
          >
            Παραγγείλετε τώρα →
          </a>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Κλείσιμο"
        className="text-emerald-900 hover:text-emerald-700"
      >
        ✕
      </button>
    </div>
  );
}
