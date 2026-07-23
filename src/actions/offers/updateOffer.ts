"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Offer } from "@/types/offers";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

/**
 * Updates an offer's top-level fields (v2 — offer is slim: name +
 * description + active). All conditionals + scopes + codes live on
 * rules; toggling offer.active cascades to all member rules at engine
 * eval time via the OR-of-parents check.
 */
export async function updateOffer(
  input: z.input<typeof Schema>
): Promise<Result<Offer>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Offer>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<Offer>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Offer>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { id, ...patch } = parsed.data;
  const updateFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updateFields[k] = v;
  }
  if (Object.keys(updateFields).length === 0) {
    return fail<Offer>("No fields to update", "NO_CHANGES");
  }

  const { data: updated, error } = await admin
    .from("offers")
    .update(updateFields)
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return fail<Offer>(
      "Failed to update offer: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "offer.updated",
    resource_type: "offer",
    resource_id: id,
    metadata: { fields_changed: Object.keys(updateFields) },
  });

  revalidatePath("/admin/discounts");
  return ok(updated as Offer);
}
