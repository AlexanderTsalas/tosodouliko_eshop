"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { FeeRule } from "@/types/fee";

const Schema = z.object({
  id: z.string().uuid().optional(),
  fee_category_id: z.string().uuid(),
  scope_type: z.enum(["global", "category", "product", "variant"]).default("global"),
  scope_id: z.string().uuid().nullable().optional(),
  rate_type: z.enum(["flat", "percentage"]),
  amount: z.number().min(0).max(99999),
  applies_to_payment_methods: z
    .array(z.enum(["stripe", "cod", "cash_on_pickup", "bank_transfer"]))
    .nullable()
    .optional(),
  applies_to_delivery_methods: z
    .array(z.enum(["home_delivery", "store_pickup", "delivery_station_pickup", "carrier_pickup"]))
    .nullable()
    .optional(),
  applies_to_carriers: z
    .array(z.enum(["acs", "elta", "box_now", "speedex", "geniki", "other"]))
    .nullable()
    .optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  combination: z.enum(["override", "add"]).optional(),
  active: z.boolean().optional(),
});

/**
 * Create-or-update a fee rule. Scope consistency is validated app-side here
 * (the DB CHECK enforces "global → no scope_id; non-global → scope_id set",
 * but doesn't verify the scope_id actually points at the right table).
 *
 * For percentage rules: amount is the percent value (e.g., 2.5 means 2.5%).
 * For flat rules: amount is the currency amount (€2.50 = 2.50).
 */
export async function saveFeeRule(
  input: z.input<typeof Schema>
): Promise<Result<FeeRule>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<FeeRule>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:fees"))) {
    return fail<FeeRule>("Forbidden", "FORBIDDEN");
  }

  // Scope consistency check.
  if (parsed.data.scope_type === "global" && parsed.data.scope_id) {
    return fail<FeeRule>("Global rules must have scope_id = null", "INVALID_INPUT");
  }
  if (parsed.data.scope_type !== "global" && !parsed.data.scope_id) {
    return fail<FeeRule>(
      `${parsed.data.scope_type}-scoped rules require a scope_id`,
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<FeeRule>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  const basePayload = {
    fee_category_id: parsed.data.fee_category_id,
    scope_type: parsed.data.scope_type,
    scope_id: parsed.data.scope_id ?? null,
    rate_type: parsed.data.rate_type,
    amount: parsed.data.amount,
    applies_to_payment_methods: parsed.data.applies_to_payment_methods ?? null,
    applies_to_delivery_methods: parsed.data.applies_to_delivery_methods ?? null,
    applies_to_carriers: parsed.data.applies_to_carriers ?? null,
    priority: parsed.data.priority ?? 100,
    combination: parsed.data.combination ?? "override",
    active: parsed.data.active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.id) {
    const { data, error } = await admin
      .from("fee_rules")
      .update(basePayload)
      .eq("id", parsed.data.id)
      .select("*")
      .single();
    if (error || !data) return fail<FeeRule>(error?.message ?? "Update failed", error?.code);

    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "fee_rule.updated",
      resource_type: "fee_rule",
      resource_id: parsed.data.id,
      metadata: { category_id: parsed.data.fee_category_id, scope: parsed.data.scope_type },
    });
    revalidatePath("/admin/settings/fees");
    return ok(data as FeeRule);
  }

  const { data, error } = await admin
    .from("fee_rules")
    .insert({ ...basePayload, created_by: authData.user.id })
    .select("*")
    .single();
  if (error || !data) return fail<FeeRule>(error?.message ?? "Insert failed", error?.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "fee_rule.created",
    resource_type: "fee_rule",
    resource_id: (data as FeeRule).id,
    metadata: {
      category_id: parsed.data.fee_category_id,
      scope: parsed.data.scope_type,
      rate_type: parsed.data.rate_type,
      amount: parsed.data.amount,
    },
  });
  revalidatePath("/admin/settings/fees");
  return ok(data as FeeRule);
}
