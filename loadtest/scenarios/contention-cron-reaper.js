/**
 * Contention — cron reaper correctness (Test 2c).
 *
 * Verifies that release_expired_priority_holds() (the pg_cron-driven reaper)
 * applies its WHERE clause discipline correctly:
 *
 *   1. NO-OP when no holds are expired — must not touch active holds with
 *      expires_at > now()
 *   2. CLEANUP + queue advance when expires_at < now()
 *   3. IDEMPOTENT — running twice in a row is safe; already-consumed holds
 *      stay consumed, no double-processing
 *
 * If the reaper had a bug where it processed ALL priority_holds (not just
 * expired ones), it would silently release active reservations belonging
 * to customers actively shopping. This test catches that.
 *
 * Setup: 5 VUs race for 1 unit → 1 holder + 4 waiters. Then the
 * orchestrator runs the three test phases.
 *
 * Prereq:
 *   npx supabase db reset --local
 *   npm run seed:contention
 *
 * Run:
 *   k6 run loadtest/scenarios/contention-cron-reaper.js
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
  runPriorityHoldReaper,
  expirePriorityHoldViaReaper,
} from "../lib/contention-flow.js";
import http from "k6/http";
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} from "../lib/config.js";

const TARGET = JSON.parse(open("../lib/contention-target.json"));
const VU_COUNT = 5; // fixed: 1 holder + 4 waiters is enough for this test

export const options = {
  scenarios: {
    setup_queue: {
      executor: "per-vu-iterations",
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: "60s",
      exec: "setupRace",
    },
    cron_phases: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "15s",
      maxDuration: "60s",
      exec: "runCronPhases",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.20"],
  },
};

/* ─── setup_queue: same shape as Test 2a but fewer VUs ─────────────────── */

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
    createCheckoutSession(customerId, cartId);
  } else if (holdResult.kind === "contention") {
    joinSoftWaitQueue(
      customerId,
      cartItemId,
      TARGET.contested_variant_id,
      1
    );
  }
}

/* ─── cron_phases: the actual reaper correctness test ──────────────────── */

/**
 * Helper: query a single priority_hold by id, return its consumed_at and
 * expires_at. Returns null if not found.
 */
function getHoldState(holdId) {
  const res = http.get(
    `${SUPABASE_URL}/rest/v1/priority_holds?id=eq.${holdId}&select=id,consumed_at,expires_at,quantity`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      tags: { name: "rest:hold_state_lookup" },
    }
  );
  if (res.status !== 200) return null;
  const rows = JSON.parse(res.body);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Helper: query inventory state for the contested variant.
 */
function getInventoryState() {
  const res = http.get(
    `${SUPABASE_URL}/rest/v1/inventory_items?variant_id=eq.${TARGET.contested_variant_id}&select=quantity_available,quantity_priority_held`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      tags: { name: "rest:inv_state_lookup" },
    }
  );
  if (res.status !== 200) return null;
  return JSON.parse(res.body)[0];
}

export function runCronPhases() {
  const variantId = TARGET.contested_variant_id;

  // ─── Pre-phase: establish the test fixture ──────────────────────────────
  // Release the holder → first waiter promoted with fresh 5-min expires_at
  const session = findActiveSoftSession(variantId);
  if (!session) {
    console.error("[cron_phases] no active soft session — setup failed");
    return;
  }
  console.log(`[cron_phases] pre: releasing holder session ${session.id}`);
  releaseSoftSession(session.id);
  sleep(0.1);

  const hold = findActivePriorityHold(variantId);
  if (!hold) {
    console.error("[cron_phases] no priority hold after release — setup failed");
    return;
  }
  console.log(
    `[cron_phases] pre: priority hold ${hold.id} active, expires_at=${hold.expires_at}`
  );

  // ─── Phase 1: reaper must IGNORE non-expired holds ──────────────────────
  // Hold's expires_at is now() + ~5min, well in the future.
  console.log("[cron_phases] PHASE 1: running reaper, expecting no-op");
  const inv_before_p1 = getInventoryState();
  const released_p1 = runPriorityHoldReaper();
  const hold_after_p1 = getHoldState(hold.id);
  const inv_after_p1 = getInventoryState();

  const phase1_pass =
    released_p1 === 0 &&
    hold_after_p1.consumed_at === null &&
    inv_before_p1.quantity_priority_held === inv_after_p1.quantity_priority_held &&
    inv_before_p1.quantity_available === inv_after_p1.quantity_available;

  console.log(
    `[cron_phases] phase 1: released=${released_p1}, ` +
      `hold.consumed_at=${hold_after_p1.consumed_at}, ` +
      `priority_held ${inv_before_p1.quantity_priority_held}→${inv_after_p1.quantity_priority_held}, ` +
      `pass=${phase1_pass}`
  );
  check(
    { phase1_pass },
    { "P1: reaper ignores non-expired holds": (r) => r.phase1_pass }
  );

  // ─── Phase 2: backdate + reap → must process and advance ────────────────
  console.log("[cron_phases] PHASE 2: backdating + running reaper, expecting cleanup");
  const released_p2 = expirePriorityHoldViaReaper(hold.id);
  const hold_after_p2 = getHoldState(hold.id);
  const next_hold = findActivePriorityHold(variantId);

  const phase2_pass =
    released_p2 === 1 &&
    hold_after_p2.consumed_at !== null &&
    next_hold !== null && // queue advanced — next waiter promoted
    next_hold.id !== hold.id;

  console.log(
    `[cron_phases] phase 2: released=${released_p2}, ` +
      `original hold consumed_at=${hold_after_p2.consumed_at}, ` +
      `next hold=${next_hold ? next_hold.id : "null"}, ` +
      `pass=${phase2_pass}`
  );
  check(
    { phase2_pass },
    { "P2: reaper processes expired + advances queue": (r) => r.phase2_pass }
  );

  // ─── Phase 3: idempotency — running reaper again must be a no-op ─────
  console.log("[cron_phases] PHASE 3: running reaper again, expecting idempotent no-op");
  const inv_before_p3 = getInventoryState();
  const released_p3 = runPriorityHoldReaper();
  const hold_after_p3 = getHoldState(hold.id); // original (already consumed)
  const next_hold_after_p3 = getHoldState(next_hold.id);
  const inv_after_p3 = getInventoryState();

  const phase3_pass =
    released_p3 === 0 && // nothing newly released
    hold_after_p3.consumed_at !== null && // still consumed (not "reset")
    next_hold_after_p3.consumed_at === null && // still active
    inv_before_p3.quantity_priority_held === inv_after_p3.quantity_priority_held &&
    inv_before_p3.quantity_available === inv_after_p3.quantity_available;

  console.log(
    `[cron_phases] phase 3: released=${released_p3}, idempotent=${phase3_pass}`
  );
  check(
    { phase3_pass },
    { "P3: reaper is idempotent on already-consumed holds": (r) => r.phase3_pass }
  );

  console.log(
    `[cron_phases] done. P1=${phase1_pass} P2=${phase2_pass} P3=${phase3_pass}`
  );
}
