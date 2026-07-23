"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Offer } from "@/types/offers";

/**
 * Two-mode bulk grouping for the left-rail multi-select flow:
 *
 *  - mode='new'      → create a brand-new offer with the given name +
 *                      description, then attach all rule_ids to it
 *  - mode='existing' → attach all rule_ids to an existing offer_id
 *
 * Returns the offer used. The M2M junction makes this idempotent —
 * rules already in the target offer stay there.
 */
const Schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    rule_ids: z.array(z.string().uuid()).min(1),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    active: z.boolean().default(true),
  }),
  z.object({
    mode: z.literal("existing"),
    rule_ids: z.array(z.string().uuid()).min(1),
    offer_id: z.string().uuid(),
  }),
]);

export async function groupRulesIntoOffer(
  input: z.input<typeof Schema>
): Promise<Result<{ offer: Offer; added: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ offer: Offer; added: number }>(
      "Invalid input: " + parsed.error.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<{ offer: Offer; added: number }>(
      "Forbidden",
      "FORBIDDEN"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ offer: Offer; added: number }>(
      "Not authenticated",
      "UNAUTHENTICATED"
    );
  }

  const admin = createAdminClient();
  let offer: Offer;

  if (parsed.data.mode === "new") {
    const { data: row, error } = await admin
      .from("offers")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        active: parsed.data.active,
        created_by: authData.user.id,
      })
      .select()
      .single();
    if (error || !row) {
      return fail<{ offer: Offer; added: number }>(
        "Failed to create offer: " + error?.message,
        error?.code
      );
    }
    offer = row as Offer;
  } else {
    const { data: row, error } = await admin
      .from("offers")
      .select("*")
      .eq("id", parsed.data.offer_id)
      .maybeSingle();
    if (error || !row) {
      return fail<{ offer: Offer; added: number }>(
        "Offer not found",
        "NOT_FOUND"
      );
    }
    offer = row as Offer;
  }

  // Upsert memberships — ignore duplicates so the operation is idempotent.
  const memberships = parsed.data.rule_ids.map((rule_id) => ({
    offer_id: offer.id,
    rule_id,
    added_by: authData.user.id,
  }));

  const { data: existing } = await admin
    .from("offer_rule_memberships")
    .select("rule_id")
    .eq("offer_id", offer.id)
    .in("rule_id", parsed.data.rule_ids);
  const existingSet = new Set(
    (existing ?? []).map((r: { rule_id: string }) => r.rule_id)
  );
  const toInsert = memberships.filter((m) => !existingSet.has(m.rule_id));

  if (toInsert.length > 0) {
    const { error: insErr } = await admin
      .from("offer_rule_memberships")
      .insert(toInsert);
    if (insErr) {
      return fail<{ offer: Offer; added: number }>(
        "Failed to insert memberships: " + insErr.message,
        insErr.code
      );
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action:
      parsed.data.mode === "new"
        ? "offer.created_from_grouping"
        : "offer.rules_added_via_grouping",
    resource_type: "offer",
    resource_id: offer.id,
    metadata: {
      rule_ids: parsed.data.rule_ids,
      added_count: toInsert.length,
    },
  });

  revalidatePath("/admin/discounts");
  return ok({ offer, added: toInsert.length });
}
