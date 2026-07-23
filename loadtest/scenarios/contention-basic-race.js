/**
 * Contention — basic race scenario.
 *
 * N VUs simultaneously try to buy 1 unit of a 1-unit variant. Verifies:
 *   - Exactly 1 winner produces 1 order
 *   - All N-1 losers join the soft-wait queue
 *   - After the winner completes, queue is collapsed and collapse_notifications
 *     are inserted for all losers
 *
 * Prerequisites:
 *   1. `npx supabase db reset --local`
 *   2. `npm run seed:contention`      ← creates the 1-unit contested variant
 *                                       and writes loadtest/lib/contention-target.json
 *   3. `npm run build:localstack && npm run start:localstack`  (prod build)
 *
 * Run:
 *   k6 run loadtest/scenarios/contention-basic-race.js
 *
 * Scale up via env var:
 *   VU_COUNT=25 k6 run loadtest/scenarios/contention-basic-race.js
 *   VU_COUNT=50 k6 run loadtest/scenarios/contention-basic-race.js
 *
 * After the run, run the assertion SQL probes in loadtest/probes/contention/
 * to verify correctness.
 *
 * IMPORTANT: this scenario hits Supabase REST directly (not the Next.js
 * server), bypassing the JS server-action layer. The contention design's
 * atomic guarantees live in Postgres RPCs + triggers — those are what this
 * test exercises. The Next.js layer is tested separately (browse scenarios).
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
  completeOrderAsWinner,
} from "../lib/contention-flow.js";

// Read the contested-variant target written by the seed script.
// SharedArray is k6's pattern for read-once-share-many init data.
const TARGET = JSON.parse(open("../lib/contention-target.json"));

const VU_COUNT = parseInt(__ENV.VU_COUNT || "5", 10);

export const options = {
  scenarios: {
    race: {
      // per-vu-iterations: N VUs each do exactly 1 iteration. With
      // gracefulStop, all VUs effectively race for the same starting moment
      // (k6 spawns them as fast as it can, typically within ~10ms).
      executor: "per-vu-iterations",
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: "120s",
    },
  },
  thresholds: {
    // No HTTP threshold here — losing the race is normal and expected.
    // The real assertions live in SQL probes after the run completes.
    // Just keep a sanity check that something isn't catastrophically wrong:
    http_req_failed: ["rate<0.10"], // <10% failures (errors from signin etc.)
  },
};

export default function () {
  // 1. Sign in anonymously — each VU gets its own customer.
  //    The signin JWT is used only to create the auth.users → user_profiles
  //    → customers chain (via triggers). All subsequent DB operations use
  //    service_role, mirroring production server-action pattern.
  const { userId } = signInAnonymous();
  const customerId = waitForCustomer(userId);

  // 2. Set up cart with the contested variant.
  const cartId = ensureCart(userId);
  const cartItemId = addCartItem(
    cartId,
    TARGET.contested_product_id,
    TARGET.contested_variant_id,
    1, // racing for 1 unit each
    24.9 // matches the seed's price; doesn't matter for contention
  );

  // 3. The race. All VUs hit hold_soft_batch at roughly the same time.
  //    With quantity_available=1, exactly one VU wins.
  const holdResult = holdSoftBatch(TARGET.contested_variant_id, 1);

  check(holdResult, {
    "hold attempt completed (ok or contention)": (r) =>
      r.kind === "ok" || r.kind === "contention",
  });

  if (holdResult.kind === "ok") {
    // ---- WINNER PATH ----
    // Create the checkout session anchor, then complete the order.
    const sessionId = createCheckoutSession(customerId, cartId);

    // Pause before collapsing so all losers have time to JOIN the queue.
    // Without this, the winner completes (and collapses an empty queue)
    // before losers finish their joinSoftWaitQueue calls — making the
    // test fail spuriously even though the design is correct.
    //
    // joinSoftWaitQueue polls for the winner's holder session for up to
    // ~1.5s. To be safe, winner waits 2.5s before completing. In
    // production this delay is supplied by the human filling out the
    // checkout form (typically tens of seconds).
    sleep(2.5);

    completeOrderAsWinner({
      customerId,
      cartId,
      sessionId,
      productId: TARGET.contested_product_id,
      variantId: TARGET.contested_variant_id,
      quantity: 1,
      unitPrice: 24.9,
    });
  } else if (holdResult.kind === "contention") {
    // ---- LOSER PATH ----
    // Join the soft-wait queue. Returns the holder session id we queued
    // behind, or null if no holder was found (timing race).
    joinSoftWaitQueue(
      customerId,
      cartItemId,
      TARGET.contested_variant_id,
      1
    );
  }
  // else: unexpected error already failed via fail() inside the helper
}
