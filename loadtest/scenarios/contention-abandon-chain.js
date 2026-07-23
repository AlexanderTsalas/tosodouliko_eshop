/**
 * Contention — abandon chain (Test 2a).
 *
 * Verifies that the soft-wait → priority-hold promotion chain advances
 * correctly through all queue members when each abandons in turn.
 *
 * Flow:
 *   1. SETUP (parallel, VU_COUNT VUs)
 *      Same as Test 1's basic race: each VU signs in, adds to cart, races
 *      for the soft-hold. Difference vs Test 1: the WINNER does NOT
 *      complete the order — they create the checkout_session and stop.
 *      End state: 1 cart_checkout_sessions in 'soft', N-1 soft_waits.
 *
 *   2. CHAIN (sequential, 1 orchestrator VU)
 *      Starts at startTime=15s, after setup has finished.
 *      - Step 1: call release_soft_session(session_id) on the holder.
 *        This promotes the FIFO-first waiter to a 5-min priority_hold.
 *      - Steps 2..N: find the active priority_hold, expire it via the
 *        cron reaper RPC. Each expiry promotes the next FIFO waiter.
 *      - Loop until no more active priority_holds exist.
 *
 * Verified by SQL after the run:
 *   - All N-1 soft_waits have promoted_at IS NOT NULL (everyone got a turn)
 *   - N-1 priority_holds exist, all with consumed_at IS NOT NULL
 *   - priority_holds.granted_at order matches soft_waits.created_at order
 *     (FIFO honored across the chain)
 *   - Final inventory: available=1, all hold counters = 0
 *
 * Prereq:
 *   npx supabase db reset --local
 *   npm run seed:contention
 *
 * Run:
 *   k6 run -e VU_COUNT=10 loadtest/scenarios/contention-abandon-chain.js
 */

import { check, sleep } from "k6";
import {
  signInAnonymous,
  waitForCustomer,
  ensureCart,
  addCartItem,
  holdSoftBatch,
  createCheckoutSession,
  joinSoftWaitQueue,
  releaseSoftSession,
  findActiveSoftSession,
  findActivePriorityHold,
  expirePriorityHoldViaReaper,
} from "../lib/contention-flow.js";

const TARGET = JSON.parse(open("../lib/contention-target.json"));
const VU_COUNT = parseInt(__ENV.VU_COUNT || "10", 10);

export const options = {
  scenarios: {
    setup_queue: {
      executor: "per-vu-iterations",
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: "60s",
      exec: "setupRace",
    },
    advance_chain: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "15s",
      maxDuration: "120s",
      exec: "advanceChain",
    },
  },
  thresholds: {
    // Higher than Test 1 because we have ~N-1 IINVT responses (one per
    // loser) which count as "failed" requests. With 10 VUs, ~9 IINVT out
    // of ~80 total ≈ 11%. With 50 VUs ≈ 10%. Threshold accommodates.
    http_req_failed: ["rate<0.20"],
  },
};

/* ─── setup_queue scenario ─────────────────────────────────────────────── */

export function setupRace() {
  const { userId } = signInAnonymous();
  const customerId = waitForCustomer(userId);
  const cartId = ensureCart(userId);
  const cartItemId = addCartItem(
    cartId,
    TARGET.contested_product_id,
    TARGET.contested_variant_id,
    1,
    24.9
  );

  const holdResult = holdSoftBatch(TARGET.contested_variant_id, 1);
  check(holdResult, {
    "hold attempt completed (ok or contention)": (r) =>
      r.kind === "ok" || r.kind === "contention",
  });

  if (holdResult.kind === "ok") {
    // ---- WINNER PATH (different from Test 1) ----
    // Create the soft session and STOP — don't complete the order.
    // The orchestrator scenario will release this session next.
    createCheckoutSession(customerId, cartId);
    // No completeOrderAsWinner call here. The session sits in 'soft' state.
  } else if (holdResult.kind === "contention") {
    // ---- LOSER PATH (same as Test 1) ----
    joinSoftWaitQueue(
      customerId,
      cartItemId,
      TARGET.contested_variant_id,
      1
    );
  }
}

/* ─── advance_chain scenario ───────────────────────────────────────────── */

export function advanceChain() {
  const variantId = TARGET.contested_variant_id;

  console.log(`[advance_chain] starting. expecting ${VU_COUNT - 1} promotions.`);

  // ─── Step 1: release the original holder session ───────────────────────
  const session = findActiveSoftSession(variantId);
  if (!session) {
    console.error(
      "[advance_chain] no active soft session found — was the setup run?"
    );
    return;
  }
  console.log(`[advance_chain] step 1: releasing holder session ${session.id}`);
  releaseSoftSession(session.id);
  // Brief pause: the advance_soft_wait_queue_for_session call inside
  // release_soft_session runs synchronously, but PostgREST's response
  // doesn't guarantee a downstream read sees the new priority_holds row
  // immediately (read-after-write on the same connection is fine, but
  // we're going through different HTTP requests on potentially different
  // pool connections). Sub-100ms is plenty.
  sleep(0.1);

  // ─── Steps 2..N: each promoted waiter abandons ─────────────────────────
  // Loop bounded by VU_COUNT for safety; in practice exits early when
  // no more active priority_holds exist (queue drained).
  let stepCount = 1; // we already did step 1 above
  for (let i = 0; i < VU_COUNT + 5; i++) {
    const hold = findActivePriorityHold(variantId);
    if (!hold) {
      console.log(
        `[advance_chain] chain complete after ${stepCount} promotions. ` +
        `no more active priority_holds.`
      );
      break;
    }
    stepCount++;
    console.log(
      `[advance_chain] step ${stepCount}: expiring priority_hold ${hold.id} ` +
      `(customer ${hold.customer_id})`
    );
    const releasedCount = expirePriorityHoldViaReaper(hold.id);
    if (releasedCount !== 1) {
      console.warn(
        `[advance_chain] step ${stepCount}: reaper released ${releasedCount} holds (expected 1)`
      );
    }
    sleep(0.1);
  }

  console.log(`[advance_chain] done. total promotions: ${stepCount}.`);
}
