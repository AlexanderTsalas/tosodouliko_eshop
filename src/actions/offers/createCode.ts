"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Code } from "@/types/offers";

const Schema = z.object({
  code: z.string().min(1).max(64),
  affiliate_id: z.string().uuid().nullable().optional(),
  max_uses_total: z.number().int().positive().nullable().optional(),
  max_uses_per_customer: z.number().int().positive().nullable().optional(),
  enforce_limits: z.boolean().default(false),
});

/**
 * Creates a standalone code (v2.5). No attachment required at creation —
 * codes can exist as drafts. Attachments are added separately via
 * attachCode actions.
 *
 * The `code` string is globally UNIQUE.
 */
export async function createCode(
  input: z.input<typeof Schema>
): Promise<Result<Code>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Code>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail<Code>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<Code>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const normalized = parsed.data.code.toUpperCase().trim();

  const { data: row, error } = await admin
    .from("codes")
    .insert({
      code: normalized,
      affiliate_id: parsed.data.affiliate_id ?? null,
      active: true,
      max_uses_total: parsed.data.max_uses_total ?? null,
      max_uses_per_customer: parsed.data.max_uses_per_customer ?? null,
      enforce_limits: parsed.data.enforce_limits,
      created_by: authData.user.id,
    })
    .select()
    .single();

  if (error || !row) {
    if (error?.code === "23505") {
      return fail<Code>(
        "Ο κωδικός υπάρχει ήδη. Ο κωδικός πρέπει να είναι μοναδικός.",
        "DUPLICATE_CODE"
      );
    }
    return fail<Code>(
      "Failed to create code: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "code.created",
    resource_type: "code",
    resource_id: (row as Code).id,
    metadata: { code: normalized },
  });

  revalidatePath("/admin/discounts");
  return ok(row as Code);
}
