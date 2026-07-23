"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteVatRate(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:vat_rates"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // Block deletion of the system default — there must always be at least one
  // default rate so resolveEffectiveVatRate has a fallback.
  const { data: row } = await supabase
    .from("vat_rates")
    .select("is_default")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (row && (row as { is_default: boolean }).is_default) {
    return fail<{ id: string }>(
      "Cannot delete the default VAT rate. Mark another rate as default first.",
      "DEFAULT_RATE"
    );
  }

  const { error } = await supabase.from("vat_rates").delete().eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "vat_rate.deleted",
      resource_type: "vat_rate",
      resource_id: parsed.data.id,
    });
  }

  revalidatePath("/admin/vat-rates");
  return ok({ id: parsed.data.id });
}
