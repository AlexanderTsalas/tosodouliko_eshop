import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";
import type { ReservationLine } from "./reserveAllOrFail";

/**
 * Atomically soft-holds inventory for an entire cart in a SINGLE
 * Postgres round-trip. Companion to reserveAllOrFail — same pattern,
 * different RPC (hold_soft_batch instead of reserve_inventory_batch).
 *
 * Atomicity is now enforced INSIDE Postgres via the hold_soft_batch
 * function (Phase 2 of the data-layer remediation). Any per-line
 * failure raises and rolls back the whole batch — there is no
 * JS-layer compensating rollback to maintain.
 *
 * Failure mapping (error.code → public failure code):
 *   - 'IINVT' (custom SQLSTATE) → "INSUFFICIENT_INVENTORY"
 *   - 'INVQT'                    → "INVALID_QUANTITY"
 *   - other                      → "SOFT_HOLD_FAILED" + raw db code
 */
export async function holdSoftAllOrFail(
  lines: ReservationLine[]
): Promise<Result<void>> {
  if (lines.length === 0) return ok(undefined);

  // Pre-validate locally so we don't even round-trip on a caller bug.
  const bad = lines.find((l) => !l.variant_id || l.quantity <= 0);
  if (bad) {
    return fail<void>(
      `Invalid line: variant_id=${bad.variant_id} qty=${bad.quantity}`,
      "INVALID_QUANTITY"
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("hold_soft_batch" as never, {
    p_lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.quantity })),
  } as never);

  if (error) return mapHoldError(error);
  return ok(undefined);
}

/**
 * Releases a batch of soft holds in one round-trip. INSUFFICIENT_SOFT_HELD
 * (SQLSTATE 'ISFTL') is treated as benign at the call-site level — it
 * means the hold was already released by another path (reaper, parallel
 * release). On batch failure, retries per-line via the legacy single-row
 * RPC as a best-effort cleanup so a single race doesn't strand other
 * holds.
 *
 * This preserves the legacy "best-effort cleanup, never crash" contract
 * while using the batch RPC for the happy path.
 */
export async function releaseSoftAll(lines: ReservationLine[]): Promise<void> {
  if (lines.length === 0) return;
  const admin = createAdminClient();

  const { error } = await admin.rpc("release_soft_batch" as never, {
    p_lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.quantity })),
  } as never);

  if (!error) return;

  // Batch failed. ISFTL is benign (race with reaper or another release path).
  // Fall back to per-line best-effort using the legacy single-row RPC for
  // anything we can still salvage.
  if (error.code !== "ISFTL") {
    console.error(
      `[releaseSoftAll] batch release failed (${error.code}): ${error.message}`
    );
  }
  for (const line of [...lines].reverse()) {
    const { error: e } = await admin.rpc("release_soft" as never, {
      p_variant_id: line.variant_id,
      p_qty: line.quantity,
    } as never);
    if (
      e &&
      !e.message?.includes("INSUFFICIENT_SOFT_HELD") &&
      e.code !== "ISFTL"
    ) {
      console.error(
        `[releaseSoftAll] per-line release_soft failed for ${line.variant_id} × ${line.quantity}: ${e.message}`
      );
    }
  }
}

/**
 * Atomically promotes all soft holds to reservations in ONE round-trip.
 * Used by placeOrder when the customer commits to payment — the soft
 * holds are already in quantity_soft_held from the session, and this
 * transitions them all to quantity_reserved.
 *
 * Postgres handles atomicity. If any line can't be promoted (SOFT_HOLD
 * vanished mid-flight, e.g. the contention reaper ran), the entire
 * transaction rolls back — no JS-layer compensating rollback needed.
 */
export async function promoteAllOrFail(
  lines: ReservationLine[]
): Promise<Result<void>> {
  if (lines.length === 0) return ok(undefined);

  const bad = lines.find((l) => !l.variant_id || l.quantity <= 0);
  if (bad) {
    return fail<void>(
      `Invalid line: variant_id=${bad.variant_id} qty=${bad.quantity}`,
      "INVALID_QUANTITY"
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc(
    "promote_soft_to_reserved_batch" as never,
    {
      p_lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.quantity })),
    } as never
  );

  if (error) {
    if (error.code === "ISFTL") {
      return fail<void>(
        `Soft hold vanished mid-promotion: ${error.message}`,
        "SOFT_HOLD_GONE"
      );
    }
    if (error.code === "INVQT") {
      return fail<void>(
        `Invalid quantity in promotion batch: ${error.message}`,
        "INVALID_QUANTITY"
      );
    }
    return fail<void>(
      `Could not promote batch: ${error.message}`,
      error.code ?? "PROMOTION_FAILED"
    );
  }
  return ok(undefined);
}

function mapHoldError(error: {
  code?: string;
  message?: string;
}): Result<void> {
  if (error.code === "IINVT") {
    return fail<void>(
      `Insufficient inventory: ${error.message}`,
      "INSUFFICIENT_INVENTORY"
    );
  }
  if (error.code === "INVQT") {
    return fail<void>(
      `Invalid quantity: ${error.message}`,
      "INVALID_QUANTITY"
    );
  }
  // Legacy fallback for the (unlikely) case where the DB returns a
  // string-only error from a pre-Phase-2 path.
  if (error.message?.includes("INSUFFICIENT_INVENTORY")) {
    return fail<void>(
      `Insufficient inventory: ${error.message}`,
      "INSUFFICIENT_INVENTORY"
    );
  }
  return fail<void>(
    `Could not soft-hold batch: ${error.message ?? "(unknown)"}`,
    error.code ?? "SOFT_HOLD_FAILED"
  );
}
