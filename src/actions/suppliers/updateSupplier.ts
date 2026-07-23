"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Supplier } from "@/types/suppliers";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  primaryEmail: z.string().email().nullable().optional(),
  primaryPhone: z.string().max(50).nullable().optional(),
  defaultCurrency: z.string().min(3).max(3).optional(),
  street: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  countryCode: z.string().length(2).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  active: z.boolean().optional(),
});

export async function updateSupplier(
  input: z.input<typeof Schema>
): Promise<Result<Supplier>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Supplier>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<Supplier>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.primaryEmail !== undefined) update.primary_email = parsed.data.primaryEmail;
  if (parsed.data.primaryPhone !== undefined) update.primary_phone = parsed.data.primaryPhone;
  if (parsed.data.defaultCurrency !== undefined) {
    update.default_currency = parsed.data.defaultCurrency.toUpperCase();
  }
  if (parsed.data.street !== undefined) update.street = parsed.data.street;
  if (parsed.data.city !== undefined) update.city = parsed.data.city;
  if (parsed.data.postalCode !== undefined) update.postal_code = parsed.data.postalCode;
  if (parsed.data.countryCode !== undefined) {
    update.country_code = parsed.data.countryCode?.toUpperCase() ?? null;
  }
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("suppliers")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    return fail<Supplier>(error?.message ?? "Update failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier.updated",
      resource_type: "supplier",
      resource_id: parsed.data.id,
      metadata: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
    });
  }

  revalidatePath("/admin/suppliers");
  return ok(data as unknown as Supplier);
}
