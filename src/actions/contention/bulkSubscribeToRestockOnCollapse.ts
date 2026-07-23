"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid(),
      })
    )
    .min(1),
});

/**
 * Bulk-subscribes the caller to restock notifications for a set of variants
 * lost to a contention collapse. Mirrors `subscribeToRestock` but lets the
 * collapse modal handle several lost items in one go.
 *
 * Wishlist tables are keyed off customer_id (since 20260601000006). We
 * resolve the customer once, get-or-create their default wishlist, then
 * upsert per (customer, product, variant) — idempotent via the UNIQUE
 * constraint.
 */
export async function bulkSubscribeToRestockOnCollapse(
  input: z.input<typeof Schema>
): Promise<Result<{ subscribed: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ subscribed: number }>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ subscribed: number }>(
      "Συνδεθείτε για να ειδοποιηθείτε όταν επιστρέψουν τα προϊόντα.",
      "UNAUTHENTICATED"
    );
  }
  if (authData.user.is_anonymous) {
    return fail<{ subscribed: number }>(
      "Δημιουργήστε λογαριασμό για να σώσετε αυτά τα προϊόντα στη λίστα επιθυμιών.",
      "ANON_NOT_ALLOWED"
    );
  }
  const userId = authData.user.id;

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<{ subscribed: number }>("Missing customer profile", "NO_CUSTOMER");
  }

  // Get-or-create the default wishlist. The customers INSERT trigger normally
  // pre-creates one, but handle the missing case defensively.
  let { data: wishlistRow } = await admin
    .from("wishlists")
    .select("id")
    .eq("customer_id", customerId)
    .eq("is_default", true)
    .maybeSingle();
  if (!wishlistRow) {
    const { data: created, error: createErr } = await admin
      .from("wishlists")
      .insert({ customer_id: customerId, name: "Λίστα επιθυμιών", is_default: true })
      .select("id")
      .single();
    if (createErr || !created) {
      return fail<{ subscribed: number }>(
        createErr?.message ?? "Failed to create wishlist",
        "WL_CREATE_FAILED"
      );
    }
    wishlistRow = created;
  }
  const wishlistId = (wishlistRow as { id: string }).id;

  const payloads = parsed.data.items.map((item) => ({
    wishlist_id: wishlistId,
    customer_id: customerId,
    product_id: item.product_id,
    variant_id: item.variant_id,
    notify_on_restock: true,
    source: "contention_modal",
  }));
  const { error: upsertErr, count: upsertCount } = await admin
    .from("wishlist_items")
    .upsert(payloads, {
      onConflict: "customer_id,product_id,variant_id",
      count: "exact",
    });
  if (upsertErr) {
    return fail<{ subscribed: number }>(upsertErr.message, upsertErr.code);
  }
  const subscribed = upsertCount ?? payloads.length;

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "wishlist.subscribed_after_collapse",
    resource_type: "customer",
    resource_id: customerId,
    metadata: { count: subscribed, variants: parsed.data.items },
  });

  revalidatePath("/wishlist");
  return ok({ subscribed });
}
