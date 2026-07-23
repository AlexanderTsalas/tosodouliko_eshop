"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import { resolveVariantInventoryIds } from "@/lib/bulk-selection/resolveVariantInventoryIds";

const FilterParamsSchema = z
  .object({
    q: z.string().optional(),
    status: z.string().optional(),
    categoryId: z.string().optional(),
    supplierId: z.string().optional(),
    trackSupply: z.string().optional(),
  })
  .optional();

const BaseSchema = z.object({
  ids: z.array(z.string().uuid()).nullable(),
  matchAll: z.boolean(),
  filterParams: FilterParamsSchema,
});

interface BulkInventoryResult {
  succeeded: number;
  failed: Array<{ variantId: string; reason: string }>;
}

// -----------------------------------------------------------------------------
// bulkSetQuantity — sets quantity_available to an absolute value for N variants.
// Absolute only, min 0, no deltas — the "after stock count" use case.
//
// Uses admin upsert (admin client bypasses RLS; permission already checked).
// A missing inventory_items row gets created with the supplied quantity.
// -----------------------------------------------------------------------------

const SetQuantitySchema = BaseSchema.extend({
  quantity: z.number().int().nonnegative(),
});

export async function bulkSetQuantity(
  input: z.input<typeof SetQuantitySchema>
): Promise<Result<BulkInventoryResult>> {
  const parsed = SetQuantitySchema.safeParse(input);
  if (!parsed.success) return fail<BulkInventoryResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<BulkInventoryResult>("Forbidden", "FORBIDDEN");
  }

  const resolved = await resolveVariantInventoryIds({
    ids: parsed.data.ids,
    matchAll: parsed.data.matchAll,
    filterParams: parsed.data.filterParams,
  });
  if (!resolved.ok) return fail<BulkInventoryResult>(resolved.error, resolved.code);
  if (resolved.variantIds.length === 0) return ok({ succeeded: 0, failed: [] });

  const admin = createAdminClient();
  const failed: Array<{ variantId: string; reason: string }> = [];
  let succeeded = 0;
  const nowIso = new Date().toISOString();

  // Single bulk upsert instead of N round-trips. Phase 9 of the
  // data-layer remediation — at 50 variants this drops from ~1.5s
  // to ~80ms.
  const rows = resolved.variantIds.map((variantId) => ({
    variant_id: variantId,
    quantity_available: parsed.data.quantity,
    updated_at: nowIso,
  }));
  const { error } = await admin
    .from("inventory_items")
    .upsert(rows, { onConflict: "variant_id" });
  if (error) {
    // Whole-batch failure: surface the error against each row so the
    // caller's failed[] array still reflects which variants didn't
    // land.
    for (const variantId of resolved.variantIds) {
      failed.push({ variantId, reason: error.message });
    }
  } else {
    succeeded = resolved.variantIds.length;
  }

  await writeAudit("inventory.bulk_set_quantity", {
    quantity: parsed.data.quantity,
    succeeded,
    failed_count: failed.length,
    variant_ids: resolved.variantIds,
  });

  revalidatePath("/admin/inventory");
  // Quantity changes flip OOS badges + facet counts on the storefront.
  updateTag("catalog-facets");
  return ok({ succeeded, failed });
}

// -----------------------------------------------------------------------------
// bulkSetThreshold — targeted UPDATE on the threshold column only.
// 0 means "untracked" — variant won't trigger low-stock alerts.
// -----------------------------------------------------------------------------

const SetThresholdSchema = BaseSchema.extend({
  threshold: z.number().int().nonnegative(),
});

export async function bulkSetThreshold(
  input: z.input<typeof SetThresholdSchema>
): Promise<Result<BulkInventoryResult>> {
  const parsed = SetThresholdSchema.safeParse(input);
  if (!parsed.success) return fail<BulkInventoryResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<BulkInventoryResult>("Forbidden", "FORBIDDEN");
  }

  const resolved = await resolveVariantInventoryIds({
    ids: parsed.data.ids,
    matchAll: parsed.data.matchAll,
    filterParams: parsed.data.filterParams,
  });
  if (!resolved.ok) return fail<BulkInventoryResult>(resolved.error, resolved.code);
  if (resolved.variantIds.length === 0) return ok({ succeeded: 0, failed: [] });

  const admin = createAdminClient();
  const failed: Array<{ variantId: string; reason: string }> = [];
  let succeeded = 0;
  const nowIso = new Date().toISOString();

  const { error } = await admin
    .from("inventory_items")
    .update({ low_stock_threshold: parsed.data.threshold, updated_at: nowIso })
    .in("variant_id", resolved.variantIds);
  if (error) {
    for (const variantId of resolved.variantIds) {
      failed.push({ variantId, reason: error.message });
    }
  } else {
    succeeded = resolved.variantIds.length;
  }

  await writeAudit("inventory.bulk_set_threshold", {
    threshold: parsed.data.threshold,
    succeeded,
    failed_count: failed.length,
    variant_ids: resolved.variantIds,
  });

  revalidatePath("/admin/inventory");
  return ok({ succeeded, failed });
}

// -----------------------------------------------------------------------------
// bulkSetTrackSupply — flag toggle on product_variants. One UPDATE with IN.
// -----------------------------------------------------------------------------

const SetTrackSupplySchema = BaseSchema.extend({
  trackSupply: z.boolean(),
});

export async function bulkSetTrackSupply(
  input: z.input<typeof SetTrackSupplySchema>
): Promise<Result<BulkInventoryResult>> {
  const parsed = SetTrackSupplySchema.safeParse(input);
  if (!parsed.success) return fail<BulkInventoryResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<BulkInventoryResult>("Forbidden", "FORBIDDEN");
  }

  const resolved = await resolveVariantInventoryIds({
    ids: parsed.data.ids,
    matchAll: parsed.data.matchAll,
    filterParams: parsed.data.filterParams,
  });
  if (!resolved.ok) return fail<BulkInventoryResult>(resolved.error, resolved.code);
  if (resolved.variantIds.length === 0) return ok({ succeeded: 0, failed: [] });

  const admin = createAdminClient();
  const failed: Array<{ variantId: string; reason: string }> = [];
  let succeeded = 0;

  const { error } = await admin
    .from("product_variants")
    .update({ track_supply: parsed.data.trackSupply })
    .in("id", resolved.variantIds);
  if (error) {
    for (const variantId of resolved.variantIds) {
      failed.push({ variantId, reason: error.message });
    }
  } else {
    succeeded = resolved.variantIds.length;
  }

  await writeAudit("inventory.bulk_set_track_supply", {
    track_supply: parsed.data.trackSupply,
    succeeded,
    failed_count: failed.length,
    variant_ids: resolved.variantIds,
  });

  revalidatePath("/admin/inventory");
  // Toggling track_supply changes whether OOS gating applies to the
  // variant on the storefront — facets + CTAs may flip.
  // (bulkSetThreshold above is admin-only metric — no storefront impact.)
  updateTag("catalog-facets");
  return ok({ succeeded, failed });
}

async function writeAudit(action: string, metadata: Record<string, unknown>) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return;
  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action,
    resource_type: "inventory_items",
    metadata,
  });
}
