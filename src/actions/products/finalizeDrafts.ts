"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import { missingForPublish } from "@/lib/products/validateDraft";

/** Hard cap on a single "Create all drafts" sweep. */
const MAX_BULK_FINALIZE = 200;

type DraftRow = {
  id: string;
  name: string | null;
  base_sku: string | null;
  base_price: number | string | null;
  is_draft: boolean;
};

async function variantCounts(
  admin: ReturnType<typeof createAdminClient>,
  productIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (productIds.length === 0) return counts;
  const { data } = await admin
    .from("product_variants")
    .select("product_id")
    .in("product_id", productIds);
  for (const r of (data ?? []) as Array<{ product_id: string }>) {
    counts.set(r.product_id, (counts.get(r.product_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Finalise a single draft — validate it's complete, then clear `is_draft`.
 * The product STAYS active=false (a finished-but-inactive product); the
 * admin activates it separately when ready. Idempotent: a row that's
 * already a non-draft returns ok without changes.
 */
export async function finalizeDraftProduct(
  id: string
): Promise<Result<{ id: string }>> {
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("products")
    .select("id, name, base_sku, base_price, is_draft")
    .eq("id", id)
    .maybeSingle();
  const product = row as DraftRow | null;
  if (!product) return fail<{ id: string }>("Το προϊόν δεν βρέθηκε.", "NOT_FOUND");
  if (!product.is_draft) return ok({ id }); // already finalised

  const counts = await variantCounts(admin, [id]);
  const missing = missingForPublish({
    name: product.name,
    baseSku: product.base_sku,
    basePrice: product.base_price === null ? null : Number(product.base_price),
    variantCount: counts.get(id) ?? 0,
  });
  if (missing.length > 0) {
    return fail<{ id: string }>(
      `Λείπουν: ${missing.join(", ")}.`,
      "INCOMPLETE_DRAFT"
    );
  }

  const { error } = await admin
    .from("products")
    .update({ is_draft: false })
    .eq("id", id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "product.draft.finalized",
    resource_type: "product",
    resource_id: id,
    metadata: { name: product.name },
  });

  revalidatePath("/admin/products");
  return ok({ id });
}

/**
 * Finalise many drafts at once. `ids` = an explicit selection; omit (or
 * null) to sweep ALL drafts. Validates each; finalises the ready ones in a
 * single update and reports the incomplete ones (with what's missing) so
 * the UI can point the admin at them.
 */
export async function finalizeDraftProducts(input: {
  ids?: string[] | null;
}): Promise<
  Result<{
    finalized: number;
    failed: Array<{ id: string; name: string | null; missing: string[] }>;
  }>
> {
  type Out = {
    finalized: number;
    failed: Array<{ id: string; name: string | null; missing: string[] }>;
  };
  if (!(await checkPermission("manage:products"))) {
    return fail<Out>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Out>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  let query = admin
    .from("products")
    .select("id, name, base_sku, base_price, is_draft")
    .eq("is_draft", true)
    .limit(MAX_BULK_FINALIZE + 1);
  if (input.ids && input.ids.length > 0) {
    query = query.in("id", input.ids);
  }
  const { data, error } = await query;
  if (error) return fail<Out>(error.message, error.code);

  const drafts = (data ?? []) as DraftRow[];
  if (drafts.length > MAX_BULK_FINALIZE) {
    return fail<Out>(
      `Πάρα πολλά πρόχειρα (μέγιστο ${MAX_BULK_FINALIZE}). Περιορίστε την επιλογή.`,
      "OVER_CAP"
    );
  }
  if (drafts.length === 0) return ok({ finalized: 0, failed: [] });

  const counts = await variantCounts(
    admin,
    drafts.map((d) => d.id)
  );

  const ready: string[] = [];
  const failed: Out["failed"] = [];
  for (const d of drafts) {
    const missing = missingForPublish({
      name: d.name,
      baseSku: d.base_sku,
      basePrice: d.base_price === null ? null : Number(d.base_price),
      variantCount: counts.get(d.id) ?? 0,
    });
    if (missing.length === 0) ready.push(d.id);
    else failed.push({ id: d.id, name: d.name, missing });
  }

  if (ready.length > 0) {
    const { error: updErr } = await admin
      .from("products")
      .update({ is_draft: false })
      .in("id", ready);
    if (updErr) return fail<Out>(updErr.message, updErr.code);

    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "product.draft.finalized_bulk",
      resource_type: "product",
      resource_id: ready[0],
      metadata: { finalized: ready.length, failed: failed.length },
    });
    revalidatePath("/admin/products");
  }

  return ok({ finalized: ready.length, failed });
}
