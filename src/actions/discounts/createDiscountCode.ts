"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { DiscountCode } from "@/types/discount-engine";

const Schema = z.object({
  code: z.string().min(1).max(64),
  type: z.enum(["percent", "fixed", "free_shipping"]),
  value: z.number().nonnegative(),
  usageLimit: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function createDiscountCode(
  input: z.input<typeof Schema>
): Promise<Result<DiscountCode>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<DiscountCode>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<DiscountCode>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<DiscountCode>("Not authenticated", "UNAUTHENTICATED");

  const { data, error } = await supabase
    .from("discount_codes")
    .insert({
      code: parsed.data.code.toUpperCase(),
      type: parsed.data.type,
      value: parsed.data.value,
      usage_limit: parsed.data.usageLimit ?? null,
      expires_at: parsed.data.expiresAt ?? null,
      is_active: parsed.data.isActive ?? true,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<DiscountCode>("Code already exists", "DUPLICATE");
    return fail<DiscountCode>(error?.message ?? "Insert failed", error?.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "discount.created",
    resource_type: "discount_code",
    resource_id: (data as any).id,
  });

  revalidatePath("/admin/discounts");
  return ok(data as unknown as DiscountCode);
}
