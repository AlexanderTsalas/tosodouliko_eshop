"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  sessionId: z.string().uuid(),
});

export async function revokeSession(
  input: z.infer<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  // RLS restricts deletion to user's own sessions.
  const { error } = await supabase
    .from("user_sessions")
    .delete()
    .eq("id", parsed.data.sessionId);

  if (error) return fail<null>(error.message, error.code);

  revalidatePath("/account/sessions");
  return ok(null);
}
