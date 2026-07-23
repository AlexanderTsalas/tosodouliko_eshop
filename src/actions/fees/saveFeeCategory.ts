"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { FeeCategory } from "@/types/fee";

const AppliesWhenSchema = z
  .object({
    payment_method: z.enum(["stripe", "cod", "cash_on_pickup", "bank_transfer"]).optional(),
    delivery_method: z
      .enum(["home_delivery", "store_pickup", "delivery_station_pickup", "carrier_pickup"])
      .optional(),
    carrier: z
      .enum(["acs", "elta", "box_now", "speedex", "geniki", "other"])
      .optional(),
    min_subtotal: z.number().min(0).optional(),
    max_subtotal: z.number().min(0).optional(),
  })
  .strict();

const Schema = z.object({
  id: z.string().uuid().optional(),
  /** Required on insert; ignored on update (slugs are immutable post-create — integration code references them). */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits, and underscores only")
    .optional(),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  applies_when: AppliesWhenSchema.optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
  percentage_base: z
    .enum(["order_subtotal", "subtotal_plus_shipping", "cod_amount", "fixed_amount"])
    .optional(),
  pricing_source: z.enum(["custom", "api"]).optional(),
  active: z.boolean().optional(),
});

/**
 * Create-or-update a fee category. On update, `slug` is ignored (system slugs
 * are immutable post-create because integration code references them). The
 * label, applies_when, ordering, and other display props are always editable.
 */
export async function saveFeeCategory(
  input: z.input<typeof Schema>
): Promise<Result<FeeCategory>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<FeeCategory>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:fees"))) {
    return fail<FeeCategory>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<FeeCategory>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  if (parsed.data.id) {
    // Update path — system row labels are still editable, but slug stays put.
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.label !== undefined) update.label = parsed.data.label;
    if (parsed.data.description !== undefined) update.description = parsed.data.description;
    if (parsed.data.applies_when !== undefined) update.applies_when = parsed.data.applies_when;
    if (parsed.data.display_order !== undefined) update.display_order = parsed.data.display_order;
    if (parsed.data.percentage_base !== undefined)
      update.percentage_base = parsed.data.percentage_base;
    if (parsed.data.pricing_source !== undefined)
      update.pricing_source = parsed.data.pricing_source;
    if (parsed.data.active !== undefined) update.active = parsed.data.active;

    const { data, error } = await admin
      .from("fee_categories")
      .update(update)
      .eq("id", parsed.data.id)
      .select("*")
      .single();
    if (error || !data) return fail<FeeCategory>(error?.message ?? "Update failed", error?.code);

    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "fee_category.updated",
      resource_type: "fee_category",
      resource_id: parsed.data.id,
      metadata: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
    });
    revalidatePath("/admin/settings/fees");
    return ok(data as FeeCategory);
  }

  // Insert path — slug required.
  if (!parsed.data.slug) {
    return fail<FeeCategory>("slug is required for new categories", "INVALID_INPUT");
  }
  const insertPayload = {
    slug: parsed.data.slug,
    label: parsed.data.label,
    description: parsed.data.description ?? null,
    applies_when: parsed.data.applies_when ?? {},
    display_order: parsed.data.display_order ?? 100,
    percentage_base: parsed.data.percentage_base ?? "order_subtotal",
    pricing_source: parsed.data.pricing_source ?? "custom",
    is_system: false,
    active: parsed.data.active ?? true,
    created_by: authData.user.id,
  };

  const { data, error } = await admin
    .from("fee_categories")
    .insert(insertPayload)
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return fail<FeeCategory>("A category with this slug already exists.", "DUPLICATE_SLUG");
    }
    return fail<FeeCategory>(error?.message ?? "Insert failed", error?.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "fee_category.created",
    resource_type: "fee_category",
    resource_id: (data as FeeCategory).id,
    metadata: { slug: parsed.data.slug, label: parsed.data.label },
  });
  revalidatePath("/admin/settings/fees");
  return ok(data as FeeCategory);
}
