"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { VatRate } from "@/types/vat-rates";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/).optional(),
  rate: z.number().min(0).max(0.9999).optional(),
  isDefault: z.boolean().optional(),
});

export async function updateVatRate(
  input: z.input<typeof Schema>
): Promise<Result<VatRate>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<VatRate>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:vat_rates"))) {
    return fail<VatRate>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // If switching to default, clear the previous default to satisfy the partial unique index.
  if (parsed.data.isDefault === true) {
    await supabase
      .from("vat_rates")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("id", parsed.data.id);
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.code !== undefined) update.code = parsed.data.code;
  if (parsed.data.rate !== undefined) update.rate = parsed.data.rate;
  if (parsed.data.isDefault !== undefined) update.is_default = parsed.data.isDefault;

  const { data, error } = await supabase
    .from("vat_rates")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<VatRate>("Code already in use", "DUPLICATE_CODE");
    return fail<VatRate>(error?.message ?? "Update failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "vat_rate.updated",
      resource_type: "vat_rate",
      resource_id: parsed.data.id,
      metadata: { fields: Object.keys(update) },
    });
  }

  revalidatePath("/admin/vat-rates");
  return ok(data as unknown as VatRate);
}
