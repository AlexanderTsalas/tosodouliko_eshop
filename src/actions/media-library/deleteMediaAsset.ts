"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Deletes the media_assets row AND attempts to remove the underlying object
 * from Storage (best-effort; Storage delete failures don't block the row delete).
 */
export async function deleteMediaAsset(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:media"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  const { data: row, error: selErr } = await supabase
    .from("media_assets")
    .select("bucket, storage_key")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (selErr) return fail<null>(selErr.message, selErr.code);

  // Remove storage object best-effort.
  if (row) {
    const admin = createAdminClient();
    await admin.storage
      .from((row as any).bucket)
      .remove([(row as any).storage_key]);
  }

  const { error } = await supabase.from("media_assets").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "media.deleted",
    resource_type: "media_asset",
    resource_id: parsed.data.id,
  });

  revalidatePath("/admin/media");
  return ok(null);
}
