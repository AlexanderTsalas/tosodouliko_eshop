/**
 * Geniki Taxydromiki service-code translation.
 *
 * Geniki's CreateJob endpoint takes a Greek two-letter `ServiceType` flag
 * that drives the operational behaviour (where the package is left,
 * whether COD is collected, branch reception, etc.). The codes in use:
 *
 *   ΑΠ — Standard home delivery (default; no service flag set)
 *   ΒΡ — Branch Reception      (παραλαβή από κατάστημα Γενικής)
 *   ΑΡ — Branch + COD          (αντικαταβολή στο κατάστημα)
 *   ΛΟ — Locker delivery        (παραλαβή από locker)
 *   ΕΞ — Express delivery       (priority — extra cost)
 *
 * Codes may be combined (e.g. ΒΡ+COD). The helper below derives the
 * single primary service code based on pickup_type and isCod; combinations
 * with non-pickup services (express, time-window) are not yet wired and
 * fall back to the home-delivery default.
 *
 * Verify against the Geniki SOAP docs before shipping — Greek-letter
 * encoding inside SOAP envelopes is sensitive to charset (UTF-8 expected).
 */

import type { VoucherContext } from "./provider";

export type GenikiServiceCode = "ΑΠ" | "ΒΡ" | "ΑΡ" | "ΛΟ";

export function genikiServiceCodeFor(ctx: VoucherContext): GenikiServiceCode {
  const isPickup = ctx.pickup_type === "branch" || ctx.pickup_type === "locker";
  const isLocker = ctx.pickup_type === "locker";
  const isCod = (ctx.cod_amount ?? 0) > 0;

  if (isLocker) return "ΛΟ";
  if (isPickup && isCod) return "ΑΡ";
  if (isPickup) return "ΒΡ";
  return "ΑΠ";
}
