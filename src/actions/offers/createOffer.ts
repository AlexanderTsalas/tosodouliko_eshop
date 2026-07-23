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
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  /** Allows the creation flow to choose whether the offer is active
   *  on first save. Defaults to true if omitted, matching the
   *  previous behaviour. */
  active: z.boolean().optional(),
});

/**
 * Creates a slim offer (v2 model — offers are just name + description +
 * active label). Offers start active by default (Q6); empty offers
 * can't fire anything so there's no safety risk. Rule membership is
 * managed separately via assignRuleToOffer.
 */
export async function createOffer(
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
  const { data: offerRow, error } = await admin
    .from("offers")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active ?? true,
      created_by: authData.user.id,
    })
    .select()
    .single();

  if (error || !offerRow) {
    return fail<Offer>(
      "Failed to create offer: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "offer.created",
    resource_type: "offer",
    resource_id: (offerRow as Offer).id,
    metadata: { name: (offerRow as Offer).name },
  });

  revalidatePath("/admin/discounts");
  return ok(offerRow as Offer);
}
