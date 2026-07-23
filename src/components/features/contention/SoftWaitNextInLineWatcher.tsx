"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  getNextInLineState,
  type NextInLineRow,
} from "@/actions/contention/getNextInLineState";
import { leaveSoftWaitQueue } from "@/actions/cart/leaveSoftWaitQueue";
import { subscribeToRestock } from "@/actions/wishlist/subscribeToRestock";
import { redirectToSignupIfNotPermanent } from "@/lib/auth/requirePermanentAccount";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Globally-mounted watcher for "I'm next in line" transitions on the
 * customer's pending soft_waits rows.
 *
 * Behavior split (unified rule per design):
 *
 *  Case A — direct entry at queue_position=1
 *    The customer joined the soft_wait queue and there's no one ahead of
 *    them. The contention modal they used already showed the max-20-min
 *    line, so we DON'T pop another modal — just surface the floating
 *    timer widget bottom-right.
 *
 *  Case B — transition from queue_position ≥ 2 → 1 (promoted forward)
 *    The customer joined further back and the queue advanced ahead of
 *    them. This is genuinely new information, so we DO pop the
 *    "Είστε επόμενος/η" modal once. After "Περιμένω" → modal closes,
 *    floating widget stays.
 *
 * The split is detected via localStorage: when we first observe a row at
 * queue_position=1, we check whether we've previously seen it at a higher
 * position. If yes, fire the modal; if no, this is direct entry — skip
 * the modal.
 *
 * Lives in the root layout so it survives navigation. Re-fetches state on:
 *   - soft_waits changes (any waiter inserted/deleted ahead of us)
 *   - cart_checkout_sessions changes (expires_at bumps, signup_detour_at
 *     stamping, state transitions)
 */
export default function SoftWaitNextInLineWatcher() {
  const router = useRouter();
  const [rows, setRows] = useState<NextInLineRow[]>([]);
  const [modalRowId, setModalRowId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Tracks the highest position we've seen each soft_wait_id at — used to
  // distinguish "joined directly at 1" (highest seen = 1) from "promoted
  // from N ≥ 2" (highest seen ≥ 2).
  const highestSeenRef = useRef<Map<string, number>>(new Map());
  // Mirror of `rows` for closures (the polling interval) that need the
  // current value rather than the captured initial.
  const rowsRef = useRef<NextInLineRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  function localSeenKey(softWaitId: string) {
    return `swnl-seen:${softWaitId}`;
  }
  function localStartKey(softWaitId: string) {
    return `swnl-startedAt:${softWaitId}`;
  }
  /**
   * Get-or-set the "became next-in-line" timestamp for a soft_wait row.
   * Capturing locally (vs. relying on cart_checkout_sessions.expires_at)
   * lets the widget display the agreed 20-min upper-bound countdown
   * regardless of the holder's actual deadline. The widget is bounded,
   * not synchronized — when the wait actually ends, the other watchers
   * (PromotionWatcher, CollapseWatcher) take over.
   */
  function getOrSetNextInLineStartedAt(softWaitId: string): number {
    if (typeof window === "undefined") return Date.now();
    const existing = window.localStorage.getItem(localStartKey(softWaitId));
    if (existing) {
      const parsed = Number(existing);
      if (Number.isFinite(parsed)) return parsed;
    }
    const now = Date.now();
    window.localStorage.setItem(localStartKey(softWaitId), String(now));
    return now;
  }

  async function refetch() {
    const r = await getNextInLineState();
    if (!r.success) return;
    const next = r.data;
    setRows(next);

    // Update highest-seen-position bookkeeping and detect 2+ → 1 transitions.
    for (const row of next) {
      const prevMax = highestSeenRef.current.get(row.soft_wait_id) ?? 0;
      const newMax = Math.max(prevMax, row.queue_position);
      highestSeenRef.current.set(row.soft_wait_id, newMax);

      if (row.queue_position === 1) {
        const alreadyAcked =
          typeof window !== "undefined" &&
          window.localStorage.getItem(localSeenKey(row.soft_wait_id)) === "1";
        // Case B: we previously saw this row at >=2 and it just hit 1.
        const cameFromBehind = prevMax >= 2;
        if (cameFromBehind && !alreadyAcked) {
          setModalRowId(row.soft_wait_id);
        }
        // Case A: prevMax was 0 or 1 — first time we see it, already at
        // position 1 → no modal. The floating widget below covers it.
      }
    }

    // Drop bookkeeping for rows that have disappeared (promoted /
    // collapsed / left); their watchers (Promotion, Collapse) take over.
    const surviving = new Set(next.map((r) => r.soft_wait_id));
    for (const id of Array.from(highestSeenRef.current.keys())) {
      if (!surviving.has(id)) highestSeenRef.current.delete(id);
    }
    if (typeof window !== "undefined") {
      // Clear the per-row "started at" timestamp once the row is gone so
      // a future re-join (rare but possible) starts a fresh 20-min count.
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i);
        if (!key || !key.startsWith("swnl-startedAt:")) continue;
        const id = key.slice("swnl-startedAt:".length);
        if (!surviving.has(id)) window.localStorage.removeItem(key);
      }
    }
    if (modalRowId && !surviving.has(modalRowId)) setModalRowId(null);
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function init() {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!authData.user) return;

      const { data: custRow } = await supabase
        .from("customers")
        .select("id")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();
      if (cancelled) return;
      const customerId = (custRow as { id: string } | null)?.id ?? null;
      if (!customerId) return;

      void refetch();

      // Phase 7 of the data-layer remediation: the soft_waits subscription
      // used to be UNFILTERED because we needed to catch "someone ahead of
      // me left the queue" events from OTHER customers' rows. That gave
      // every connected client a copy of every other client's soft_waits
      // events — at scale, broadcast bandwidth explodes.
      //
      // The fix is two-part:
      //   1. Scope the Realtime subscription to OUR customer_id. This
      //      catches our own row changes (insert, promotion, deletion)
      //      cheaply via the filter.
      //   2. A periodic poll fires every 10s while we have an active
      //      queue position to catch "queue advanced ahead of me" events.
      //      10s lag on a queue-position UI is acceptable (the user is
      //      already in a wait state).
      // cart_checkout_sessions subscription stays narrow via customer_id
      // (the holder sessions we wait behind belong to other customers,
      // BUT the watcher only renders on rows OUR customer owns, so we
      // can target by customer_id).
      const channel = supabase
        .channel(`soft-wait-next-${customerId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "soft_waits",
            filter: `customer_id=eq.${customerId}`,
          },
          () => {
            void refetch();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "cart_checkout_sessions",
            filter: `customer_id=eq.${customerId}`,
          },
          () => {
            void refetch();
          }
        )
        .subscribe();

      // Polling fallback for queue-advancement events. Only ticks while
      // there's an active queue position — otherwise idle. 10s cadence
      // balances UX freshness against poll cost.
      const pollInterval = window.setInterval(() => {
        // Quick check: any waiting position currently surfaced?
        // (rows length being > 0 is the trigger; setRows runs the side
        // effect of populating it after each refetch.)
        if (rowsRef.current.length > 0) void refetch();
      }, 10_000);

      return () => {
        window.clearInterval(pollInterval);
        void supabase.removeChannel(channel);
      };
    }

    let cleanup: (() => void) | void;
    void init().then((c) => {
      cleanup = c;
    });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ackRow(softWaitId: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(localSeenKey(softWaitId), "1");
    }
  }

  function dismissModal() {
    if (modalRowId) ackRow(modalRowId);
    setModalRowId(null);
  }

  function handleLeaveQueue(softWaitId: string) {
    startTransition(async () => {
      const r = await leaveSoftWaitQueue({ soft_wait_id: softWaitId });
      if (r.success) {
        // Clear local seen state so a re-join would pop the modal fresh.
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(localSeenKey(softWaitId));
        }
        router.refresh();
      }
    });
  }

  /**
   * Switch from "waiting in queue" to "notify me when back in stock". Drops
   * the queue position (and the cart item) and creates a wishlist row with
   * notify_on_restock=true. Anonymous users get routed through signup
   * first via redirectToSignupIfNotPermanent; on return they re-click to
   * complete. Mirrors the original contention modal's subscribe path,
   * adapted to the already-queued state.
   */
  function handleSubscribeAndLeave(row: NextInLineRow) {
    startTransition(async () => {
      const isPermanent = await redirectToSignupIfNotPermanent();
      if (!isPermanent) return; // navigation in progress
      const sub = await subscribeToRestock({
        productId: row.product_id,
        variantId: row.variant_id,
        source: "contention_modal",
      });
      if (!sub.success) return;
      const leave = await leaveSoftWaitQueue({ soft_wait_id: row.soft_wait_id });
      if (leave.success) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(localSeenKey(row.soft_wait_id));
        }
        router.refresh();
      }
    });
  }

  const modalRow = modalRowId
    ? rows.find((r) => r.soft_wait_id === modalRowId) ?? null
    : null;
  const widgetRows = rows.filter((r) => r.queue_position === 1);

  return (
    <>
      {/* Case-B modal: appears once on the 2+ → 1 transition. */}
      <Dialog open={modalRow !== null} onOpenChange={(o) => !o && dismissModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Είστε επόμενος/η σε σειρά αναμονής</DialogTitle>
            <DialogDescription>
              {modalRow && (
                <>
                  Ο τρέχων πελάτης έχει μέγιστο χρόνο{" "}
                  <strong>20 λεπτά</strong> να ολοκληρώσει την παραγγελία
                  του για το{" "}
                  <Link
                    href={`/products/${modalRow.product_slug}`}
                    className="underline"
                  >
                    {modalRow.product_name}
                  </Link>
                  {modalRow.variant_label && ` (${modalRow.variant_label})`}.
                  Θέλετε να περιμένετε;
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <button
              type="button"
              onClick={dismissModal}
              className="w-full rounded border border-primary bg-primary text-primary-foreground px-4 py-3 text-left"
            >
              <p className="font-medium">Περιμένω</p>
              <p className="text-xs opacity-90 mt-0.5">
                Θα ειδοποιηθείτε όταν είναι η σειρά σας. Το χρονόμετρο θα
                συνεχίσει στην κάτω δεξιά γωνία.
              </p>
            </button>
            <button
              type="button"
              onClick={() => modalRow && handleSubscribeAndLeave(modalRow)}
              disabled={isPending}
              className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
            >
              <p className="font-medium">
                Ειδοποιήστε με όταν επιστρέψει σε απόθεμα
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Φεύγετε από τη λίστα αναμονής και προστίθεται στη λίστα
                επιθυμιών. Θα λάβετε email όταν το προϊόν επιστρέψει σε
                απόθεμα.
              </p>
            </button>
            <button
              type="button"
              onClick={() => modalRowId && handleLeaveQueue(modalRowId)}
              disabled={isPending}
              className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
            >
              <p className="font-medium">Συνέχεια αγορών</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Φεύγετε από τη λίστα αναμονής. Το προϊόν αφαιρείται από το
                καλάθι σας.
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating widgets: one per row currently at queue_position=1 that
          isn't the actively-modal row. Stacks vertically bottom-right if
          multiple. */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-xs">
        {widgetRows
          .filter((r) => r.soft_wait_id !== modalRowId)
          .map((r) => (
            <NextInLineWidget
              key={r.soft_wait_id}
              row={r}
              startedAt={getOrSetNextInLineStartedAt(r.soft_wait_id)}
              onOpenOptions={() => setModalRowId(r.soft_wait_id)}
            />
          ))}
      </div>
    </>
  );
}

const NEXT_IN_LINE_MAX_MS = 20 * 60 * 1000;

function NextInLineWidget({
  row,
  startedAt,
  onOpenOptions,
}: {
  row: NextInLineRow;
  /** Wall-clock ms when this customer became next-in-line. Fixed; not tied
   *  to the holder's session expires_at. The widget is an upper-bound
   *  visual — actual transitions (promotion / collapse) are delivered by
   *  the other watchers. */
  startedAt: number;
  /** Reopen the choices modal (Περιμένω / Συνέχεια αγορών). Mirrors the
   *  holder's contention widget — the steady-state UI is a compact
   *  countdown; the full decision surface is one tap away. */
  onOpenOptions: () => void;
}) {
  const deadlineMs = startedAt + NEXT_IN_LINE_MAX_MS;
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    Math.max(0, deadlineMs - Date.now())
  );

  useEffect(() => {
    setRemainingMs(Math.max(0, deadlineMs - Date.now()));
    const id = window.setInterval(() => {
      setRemainingMs(Math.max(0, deadlineMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadlineMs]);

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;

  return (
    <div className="rounded-lg border border-amber-300 bg-white shadow-lg p-3 text-sm">
      <p className="font-medium text-amber-900">Είστε επόμενος/η σε σειρά</p>
      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
        {row.product_name}
        {row.variant_label && ` · ${row.variant_label}`}
      </p>
      <p className="font-mono text-2xl font-semibold text-amber-700 mt-1">
        {mm}:{ss.toString().padStart(2, "0")}
      </p>
      {row.signup_detour_active && (
        <p className="text-xs text-amber-800 mt-1">
          Ο πελάτης κάνει εγγραφή — λίγο ακόμη.
        </p>
      )}
      <button
        type="button"
        onClick={onOpenOptions}
        className="mt-2 w-full rounded border border-amber-700 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50"
      >
        Επιλογές
      </button>
    </div>
  );
}
