"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { VolumetricPrefix } from "@/types/volumetric";

/**
 * CRUD for volumetric_prefixes. The table is admin-managed reference
 * data — every action gates on manage:couriers (same permission that
 * governs the courier-settings page where the UI lives).
 *
 * The carrier_codes jsonb field is free-form: any string key with a
 * string-or-number value. The schema doesn't enforce which carriers
 * are valid because the carrier list is itself admin-editable; if a
 * code is set for a carrier that doesn't exist anymore, it's just
 * unused data (cheap).
 */

const CarrierCodesSchema = z.record(z.union([z.string(), z.number()]));

const CreateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_-]+$/, "Slug: lowercase letters, numbers, hyphens or underscores only"),
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  maxLengthMm: z.number().int().positive().nullable().optional(),
  maxWidthMm: z.number().int().positive().nullable().optional(),
  maxHeightMm: z.number().int().positive().nullable().optional(),
  maxWeightG: z.number().int().positive().nullable().optional(),
  carrierCodes: CarrierCodesSchema.optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});

export async function createVolumetricPrefix(
  input: z.input<typeof CreateSchema>
): Promise<Result<VolumetricPrefix>> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail<VolumetricPrefix>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:couriers"))) {
    return fail<VolumetricPrefix>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("volumetric_prefixes")
    .insert({
      slug: parsed.data.slug,
      display_name: parsed.data.displayName,
      description: parsed.data.description ?? null,
      max_length_mm: parsed.data.maxLengthMm ?? null,
      max_width_mm: parsed.data.maxWidthMm ?? null,
      max_height_mm: parsed.data.maxHeightMm ?? null,
      max_weight_g: parsed.data.maxWeightG ?? null,
      carrier_codes: parsed.data.carrierCodes ?? {},
      display_order: parsed.data.displayOrder ?? 100,
      active: parsed.data.active ?? true,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return fail<VolumetricPrefix>("Slug already in use", "DUPLICATE_SLUG");
    }
    return fail<VolumetricPrefix>(error?.message ?? "Insert failed", error?.code);
  }

  if (authData?.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "volumetric_prefix.created",
      resource_type: "volumetric_prefix",
      resource_id: (data as { id: string }).id,
      metadata: { slug: parsed.data.slug },
    });
  }

  revalidatePath("/admin/settings/couriers");
  return ok(data as unknown as VolumetricPrefix);
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  maxLengthMm: z.number().int().positive().nullable().optional(),
  maxWidthMm: z.number().int().positive().nullable().optional(),
  maxHeightMm: z.number().int().positive().nullable().optional(),
  maxWeightG: z.number().int().positive().nullable().optional(),
  carrierCodes: CarrierCodesSchema.optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});

export async function updateVolumetricPrefix(
  input: z.input<typeof UpdateSchema>
): Promise<Result<VolumetricPrefix>> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail<VolumetricPrefix>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:couriers"))) {
    return fail<VolumetricPrefix>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.displayName !== undefined) update.display_name = parsed.data.displayName;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.maxLengthMm !== undefined) update.max_length_mm = parsed.data.maxLengthMm;
  if (parsed.data.maxWidthMm !== undefined) update.max_width_mm = parsed.data.maxWidthMm;
  if (parsed.data.maxHeightMm !== undefined) update.max_height_mm = parsed.data.maxHeightMm;
  if (parsed.data.maxWeightG !== undefined) update.max_weight_g = parsed.data.maxWeightG;
  if (parsed.data.carrierCodes !== undefined) update.carrier_codes = parsed.data.carrierCodes;
  if (parsed.data.displayOrder !== undefined) update.display_order = parsed.data.displayOrder;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const { data, error } = await supabase
    .from("volumetric_prefixes")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    return fail<VolumetricPrefix>(error?.message ?? "Update failed", error?.code);
  }

  if (authData?.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "volumetric_prefix.updated",
      resource_type: "volumetric_prefix",
      resource_id: parsed.data.id,
      metadata: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
    });
  }

  revalidatePath("/admin/settings/couriers");
  return ok(data as unknown as VolumetricPrefix);
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteVolumetricPrefix(
  input: z.input<typeof DeleteSchema>
): Promise<Result<null>> {
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:couriers"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // products.volumetric_prefix_id has ON DELETE SET NULL — any product
  // referencing this prefix simply loses the assignment. We surface a
  // gentle heads-up here via a pre-check so admins know how many
  // products will be affected before they pull the trigger.
  const { count: usedBy } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("volumetric_prefix_id", parsed.data.id);

  const { error } = await supabase
    .from("volumetric_prefixes")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return fail<null>(error.message, error.code);

  if (authData?.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "volumetric_prefix.deleted",
      resource_type: "volumetric_prefix",
      resource_id: parsed.data.id,
      metadata: { products_affected: usedBy ?? 0 },
    });
  }

  revalidatePath("/admin/settings/couriers");
  return ok(null);
}
