/**
 * Contention — abandon chain × 3 parallel (Test 2b).
 *
 * Three independent contention chains advance concurrently, verifying
 * cross-chain isolation. If operations on chain A leak into chain B's
 * state (wrong customer promoted, wrong inventory adjusted, queue mixed
 * up), this test catches it.
 *
 * Setup (parallel): 30 VUs total, deterministically split into 3 groups
 * of 10 by `__VU % 3`. Each VU targets ONE of the 3 contested variants.
 * Within each group: 1 wins the soft-hold, 9 join the soft_wait queue.
 *
 * Chain phase (parallel): 3 orchestrator VUs start at startTime=20s,
 * each handling one chain. All three chains advance simultaneously —
 * the orchestrators don't coordinate.
 *
 * Verified by SQL after the run:
 *   - Each chain drained correctly (per-variant identical to Test 2a)
 *   - FIFO order preserved WITHIN each chain
 *   - No cross-chain leakage (customer X in chain A never appears in
 *     priority_holds for chain B's variant)
 *
 * Prereq:
 *   npx supabase db reset --local
 *   npm run seed:contention-parallel
 *
 * Run:
 *   k6 run loadtest/scenarios/contention-abandon-chain-parallel.js
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

const TARGET = JSON.parse(open("../lib/contention-parallel-target.json"));
const VUS_PER_CHAIN = 10;
const CHAIN_COUNT = TARGET.contested_count; // 3

if (CHAIN_COUNT !== 3) {
  throw new Error(
    `contention-parallel target expects 3 chains, got ${CHAIN_COUNT}. ` +
      `Re-seed via npm run seed:contention-parallel.`
  );
}

const TOTAL_SETUP_VUS = VUS_PER_CHAIN * CHAIN_COUNT; // 30

export const options = {
  scenarios: {
    setup_queues: {
      executor: "per-vu-iterations",
      vus: TOTAL_SETUP_VUS,
      iterations: 1,
      maxDuration: "60s",
      exec: "setupRace",
    },
    advance_chains: {
      executor: "per-vu-iterations",
      vus: CHAIN_COUNT, // 3 orchestrators, one per chain
      iterations: 1,
      startTime: "20s", // give setup_queues time to finish (slower because 30 VUs)
      maxDuration: "120s",
      exec: "advanceChain",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.20"],
  },
};

/**
 * Map a VU number (1-indexed, k6 convention) to its chain index (0-indexed).
 * Each VU stays on the same chain across its iteration.
 *
 *   VU 1, 4, 7, 10, 13, 16, 19, 22, 25, 28 → chain 0
 *   VU 2, 5, 8, 11, 14, 17, 20, 23, 26, 29 → chain 1
 *   VU 3, 6, 9, 12, 15, 18, 21, 24, 27, 30 → chain 2
 *
 * Each chain gets exactly 10 VUs (VUS_PER_CHAIN).
 */
function chainIndexForVU(vuNumber) {
  return (vuNumber - 1) % CHAIN_COUNT;
}

/* ─── setup_queues: 30 VUs race in parallel, 10 per chain ──────────────── */

export function setupRace() {
  const chainIdx = chainIndexForVU(__VU);
  const target = TARGET.contested_variants[chainIdx];

  const { userId } = signInAnonymous();
  const customerId = waitForCustomer(userId);
  const cartId = ensureCart(userId);
  const cartItemId = addCartItem(
    cartId,
    target.product_id,
    target.variant_id,
    1,
    24.9
  );

  const holdResult = holdSoftBatch(target.variant_id, 1);
  check(holdResult, {
    "hold attempt completed (ok or contention)": (r) =>
      r.kind === "ok" || r.kind === "contention",
  });

  if (holdResult.kind === "ok") {
    createCheckoutSession(customerId, cartId);
  } else if (holdResult.kind === "contention") {
    joinSoftWaitQueue(customerId, cartItemId, target.variant_id, 1);
  }
}

/* ─── advance_chains: 3 orchestrators, each draining one chain ────────── */

export function advanceChain() {
  const chainIdx = chainIndexForVU(__VU);
  const target = TARGET.contested_variants[chainIdx];
  const variantId = target.variant_id;
  const tag = `chain[${chainIdx}=${target.product_slug}]`;

  console.log(
    `[${tag}] starting. expecting ${VUS_PER_CHAIN - 1} promotions.`
  );

  // Step 1: release the holder
  const session = findActiveSoftSession(variantId);
  if (!session) {
    console.error(`[${tag}] no active soft session found`);
    return;
  }
  console.log(`[${tag}] step 1: releasing holder ${session.id}`);
  releaseSoftSession(session.id);
  sleep(0.1);

  // Steps 2..N
  let stepCount = 1;
  for (let i = 0; i < VUS_PER_CHAIN + 5; i++) {
    const hold = findActivePriorityHold(variantId);
    if (!hold) {
      console.log(`[${tag}] chain complete after ${stepCount} promotions`);
      break;
    }
    stepCount++;
    console.log(`[${tag}] step ${stepCount}: expiring hold ${hold.id}`);
    expirePriorityHoldViaReaper(hold.id);
    sleep(0.1);
  }

  console.log(`[${tag}] done. total promotions: ${stepCount}`);
}
