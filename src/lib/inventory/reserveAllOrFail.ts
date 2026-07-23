import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

export interface ReservationLine {
  variant_id: string;
  quantity: number;
}

/**
 * Atomically reserves inventory for an entire cart in a SINGLE Postgres
 * round-trip via reserve_inventory_batch. Used at order placement to
 * swing available→reserved for every line in one transaction.
 *
 * Postgres-level atomicity: any per-line failure RAISES and rolls back
 * the whole batch. There is no JS-layer compensating rollback.
 *
 * Failure modes returned to caller:
 *   - INSUFFICIENT_INVENTORY — at least one line couldn't be reserved
 *                              (custom SQLSTATE 'IINVT')
 *   - INVALID_QUANTITY        — non-positive quantity (caller bug)
 *                              (custom SQLSTATE 'INVQT')
 *   - <error.code from PostgREST> — DB-level error
 *
 * Caller responsibility unchanged: reserve first, then insert the order
 * row (so failure leaves no orphan order). If downstream order-insert
 * fails, call `releaseAll` to undo the batch reservation.
 */
export async function reserveAllOrFail(
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
  const { error } = await admin.rpc("reserve_inventory_batch" as never, {
    p_lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.quantity })),
  } as never);

  if (error) return mapReserveError(error);
  return ok(undefined);
}

/**
 * Releases a batch of reservations in ONE round-trip via
 * release_reservation_batch. Used externally as a compensating action
 * when downstream order-insert steps fail after a successful
 * reserveAllOrFail.
 *
 * Best-effort cleanup: on batch failure, falls back to per-line release
 * via the legacy single-row RPC so a single race doesn't strand other
 * reservations. A residual stuck reservation is the worst outcome here
 * and is recoverable by admin via the inventory page.
 */
export async function releaseAll(lines: ReservationLine[]): Promise<void> {
  if (lines.length === 0) return;
  const admin = createAdminClient();

  const { error } = await admin.rpc("release_reservation_batch" as never, {
    p_lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.quantity })),
  } as never);

  if (!error) return;

  // Batch failed. IRSRV (INSUFFICIENT_RESERVED) is benign — the
  // reservation was already released by another path. Anything else is
  // logged. Fall back to per-line best-effort so a single race doesn't
  // strand the remaining reservations.
  if (error.code !== "IRSRV") {
    console.error(
      `[releaseAll] batch release_reservation failed (${error.code}): ${error.message}`
    );
  }
  for (const line of [...lines].reverse()) {
    const { error: e } = await admin.rpc("release_reservation" as never, {
      p_variant_id: line.variant_id,
      p_qty: line.quantity,
    } as never);
    if (
      e &&
      !e.message?.includes("INSUFFICIENT_RESERVED") &&
      e.code !== "IRSRV"
    ) {
      console.error(
        `[releaseAll] per-line release_reservation failed for ${line.variant_id} × ${line.quantity}: ${e.message}`
      );
    }
  }
}

function mapReserveError(error: {
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
  // Legacy fallback if a pre-Phase-2 path still raises plain P0001.
  if (error.message?.includes("INSUFFICIENT_INVENTORY")) {
    return fail<void>(
      `Insufficient inventory: ${error.message}`,
      "INSUFFICIENT_INVENTORY"
    );
  }
  return fail<void>(
    `Could not reserve batch: ${error.message ?? "(unknown)"}`,
    error.code ?? "RESERVATION_FAILED"
  );
}
