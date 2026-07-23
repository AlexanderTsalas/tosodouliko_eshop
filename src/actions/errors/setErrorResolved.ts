"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  id: z.string().uuid(),
  resolved: z.boolean(),
});

export async function setErrorResolved(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("read:errors"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("error_events")
    .update({ resolved: parsed.data.resolved })
    .eq("id", parsed.data.id);

  if (error) return fail<null>(error.message, error.code);
  revalidatePath("/admin/errors");
  return ok(null);
}
