"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { VatRate } from "@/types/vat-rates";

const Schema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, "Code must be UPPER_SNAKE."),
  rate: z.number().min(0).max(0.9999),
  isDefault: z.boolean().default(false),
});

export async function createVatRate(
  input: z.input<typeof Schema>
): Promise<Result<VatRate>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<VatRate>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:vat_rates"))) {
    return fail<VatRate>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // If marking as default, clear any other default first (unique partial index
  // would block the insert otherwise).
  if (parsed.data.isDefault) {
    await supabase.from("vat_rates").update({ is_default: false }).eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("vat_rates")
    .insert({
      name: parsed.data.name,
      code: parsed.data.code,
      rate: parsed.data.rate,
      is_default: parsed.data.isDefault,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<VatRate>("Code already in use", "DUPLICATE_CODE");
    return fail<VatRate>(error?.message ?? "Insert failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "vat_rate.created",
      resource_type: "vat_rate",
      resource_id: (data as { id: string }).id,
      metadata: { name: parsed.data.name, code: parsed.data.code, rate: parsed.data.rate },
    });
  }

  revalidatePath("/admin/vat-rates");
  return ok(data as unknown as VatRate);
}
