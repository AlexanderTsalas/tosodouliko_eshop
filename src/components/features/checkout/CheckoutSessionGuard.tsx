"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordCheckoutInteraction } from "@/actions/checkout/recordCheckoutInteraction";

interface Props {
  sessionId: string;
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const INTERACTION_THROTTLE_MS = 60_000;

/**
 * Invisible liveness for the /checkout page's soft session. Three concurrent
 * side effects, no rendered UI (ContentionBanner owns the visual surface
 * including the timer when contention is active):
 *
 *   1. Heartbeat (10s POST /api/checkout/heartbeat) — the existing
 *      stale-heartbeat reaper releases sessions whose ping stops.
 *   2. Interaction tracker (click/keydown/scroll → recordCheckoutInteraction,
 *      throttled to once per minute). Drives the 30-min idle backstop.
 *   3. Eviction redirect: subscribes to the session row via Realtime; if the
 *      state moves out of 'soft' (paid, released, etc.) OR the contention-
 *      driven expires_at passes, redirects the customer to /cart so they
 *      can re-acquire if they want.
 */
export default function CheckoutSessionGuard({ sessionId }: Props) {
  const router = useRouter();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<string>("soft");
  const hasEvictedRef = useRef(false);

  // Fetch + subscribe to the session row for live expires_at / state.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function refetch() {
      const { data } = await supabase
        .from("cart_checkout_sessions")
        .select("expires_at, state")
        .eq("id", sessionId)
        .maybeSingle();
      if (cancelled) return;
      const s = data as { expires_at: string | null; state: string } | null;
      setExpiresAt(s?.expires_at ?? null);
      setSessionState(s?.state ?? "released");
    }
    refetch();

    const channel = supabase
      .channel(`checkout-guard-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cart_checkout_sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => refetch()
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // Eviction on state change (paid/released/etc.) — go back to cart.
  useEffect(() => {
    if (sessionState === "soft" || hasEvictedRef.current) return;
    hasEvictedRef.current = true;
    router.replace("/cart?session_expired=1");
  }, [sessionState, router]);

  // Eviction on contention-driven expiry. Only fires when expires_at is set.
  useEffect(() => {
    if (!expiresAt || hasEvictedRef.current) return;
    const expiresMs = new Date(expiresAt).getTime();
    const now = Date.now();
    if (expiresMs <= now) {
      hasEvictedRef.current = true;
      router.replace("/cart?session_expired=1");
      return;
    }
    const id = window.setTimeout(() => {
      if (hasEvictedRef.current) return;
      hasEvictedRef.current = true;
      router.replace("/cart?session_expired=1");
    }, expiresMs - now);
    return () => window.clearTimeout(id);
  }, [expiresAt, router]);

  // Heartbeat.
  useEffect(() => {
    function ping() {
      if (hasEvictedRef.current) return;
      try {
        fetch("/api/checkout/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }
    ping();
    const id = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [sessionId]);

  // Interaction tracker.
  useEffect(() => {
    let lastSent = 0;
    function maybeRecord() {
      if (hasEvictedRef.current) return;
      const now = Date.now();
      if (now - lastSent < INTERACTION_THROTTLE_MS) return;
      lastSent = now;
      void recordCheckoutInteraction({ session_id: sessionId });
    }
    const events: Array<keyof DocumentEventMap> = ["click", "keydown", "scroll"];
    for (const ev of events) document.addEventListener(ev, maybeRecord, { passive: true });
    return () => {
      for (const ev of events) document.removeEventListener(ev, maybeRecord);
    };
  }, [sessionId]);

  return null;
}
