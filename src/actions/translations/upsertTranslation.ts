"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { Translation } from "@/types/translation-layer";

const Schema = z.object({
  namespace: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  locale: z.string().min(2).max(10),
  value: z.string().max(5000),
});

export async function upsertTranslation(
  input: z.input<typeof Schema>
): Promise<Result<Translation>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Translation>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:translations"))) {
    return fail<Translation>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("translations")
    .upsert(
      {
        namespace: parsed.data.namespace,
        key: parsed.data.key,
        locale: parsed.data.locale,
        value: parsed.data.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "namespace,key,locale" }
    )
    .select()
    .single();

  if (error || !data) return fail<Translation>(error?.message ?? "Upsert failed", error?.code);
  revalidatePath("/admin/translations");
  return ok(data as unknown as Translation);
}
