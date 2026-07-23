"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

/**
 * Create a blank DRAFT product for the inline "New Product" flow.
 *
 * The row is real (so the existing DB-backed panel can edit it with
 * autosave), but born:
 *   - active = false  → invisible to the storefront via RLS
 *   - is_draft = true → distinguishable from intentionally-inactive
 *     finished products, so the stale-draft reaper can clean it up safely
 *
 * Zero variants by design — the variants tab adds them; finalising
 * ("Create Product") gates on ≥1 variant + Base SKU + price. The slug is a
 * throwaway unique placeholder (slug is NOT NULL UNIQUE) the admin replaces
 * before finalising.
 */
export async function createDraftProduct(): Promise<Result<{ id: string }>> {
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  // Suffix the placeholder name with the running draft count (#2, #3 …) so
  // multiple drafts are visually distinguishable in the table.
  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("is_draft", true);
  const n = (count ?? 0) + 1;
  const name = n === 1 ? "Νέο προϊόν" : `Νέο προϊόν #${n}`;

  const { data, error } = await admin
    .from("products")
    .insert({
      name,
      slug: `draft-${randomUUID()}`,
      base_price: 0,
      currency: "EUR",
      active: false,
      is_draft: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    return fail<{ id: string }>(error?.message ?? "Insert failed", error?.code);
  }

  const id = (data as { id: string }).id;

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "product.draft.created",
    resource_type: "product",
    resource_id: id,
    metadata: { name },
  });

  revalidatePath("/admin/products");
  return ok({ id });
}
