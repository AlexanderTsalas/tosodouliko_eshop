"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Supplier } from "@/types/suppliers";

const Schema = z.object({
  name: z.string().min(1).max(200),
  primaryEmail: z.string().email().nullable().optional(),
  primaryPhone: z.string().max(50).nullable().optional(),
  defaultCurrency: z.string().min(3).max(3).default("EUR"),
  street: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  countryCode: z.string().length(2).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function createSupplier(
  input: z.input<typeof Schema>
): Promise<Result<Supplier>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Supplier>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<Supplier>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: parsed.data.name,
      primary_email: parsed.data.primaryEmail ?? null,
      primary_phone: parsed.data.primaryPhone ?? null,
      default_currency: parsed.data.defaultCurrency.toUpperCase(),
      street: parsed.data.street ?? null,
      city: parsed.data.city ?? null,
      postal_code: parsed.data.postalCode ?? null,
      country_code: parsed.data.countryCode?.toUpperCase() ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return fail<Supplier>(error?.message ?? "Insert failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier.created",
      resource_type: "supplier",
      resource_id: (data as { id: string }).id,
      metadata: { name: parsed.data.name },
    });
  }

  revalidatePath("/admin/suppliers");
  return ok(data as unknown as Supplier);
}
