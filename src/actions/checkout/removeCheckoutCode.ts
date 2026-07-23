"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
  code: z.string().min(1).max(64),
});

export async function removeCheckoutCode(
  input: z.input<typeof Schema>
): Promise<Result<{ session_id: string; applied_codes: string[] }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const codeText = parsed.data.code.toUpperCase().trim();

  // Ownership + current state.
  const { data: customerRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (customerRow as { id: string } | null)?.id ?? null;

  const { data: sessionRow, error: sErr } = await admin
    .from("cart_checkout_sessions")
    .select("applied_codes, customer_id")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  if (sErr) return fail(sErr.message, sErr.code);
  if (!sessionRow) return fail("Checkout session not found", "NOT_FOUND");
  if (customerId === null || (sessionRow as { customer_id: string }).customer_id !== customerId) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const existing = ((sessionRow as { applied_codes: string[] }).applied_codes ?? []) as string[];
  const next = existing.filter((c) => c !== codeText);
  if (next.length === existing.length) {
    return ok({ session_id: parsed.data.session_id, applied_codes: existing });
  }

  const { error: updErr } = await admin
    .from("cart_checkout_sessions")
    .update({ applied_codes: next })
    .eq("id", parsed.data.session_id);
  if (updErr) return fail(updErr.message, updErr.code);

  revalidatePath("/checkout");
  return ok({ session_id: parsed.data.session_id, applied_codes: next });
}
