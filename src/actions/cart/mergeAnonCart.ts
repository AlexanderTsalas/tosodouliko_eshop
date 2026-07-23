"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  anon_user_id: z.string().uuid(),
});

interface MergeResult {
  merged_items: number;
  /** Set when the anon cart had nothing to merge — caller can ignore. */
  skipped: boolean;
}

/**
 * Phase 9C — cart merge on anonymous → permanent transition.
 *
 * Called by LoginForm and SignupForm right after a successful signIn/signUp.
 * The caller captures `auth.getUser().id` BEFORE the auth swap (the anonymous
 * user id) and passes it here AFTER the swap (now authenticated as the
 * permanent user). We then:
 *
 *   1. Verify the caller is now permanent (not anonymous) and the supplied
 *      `anon_user_id` actually points to an anonymous user — guards against
 *      a malicious caller asking us to merge somebody else's cart.
 *   2. Load the anonymous user's active cart and the permanent user's
 *      active cart (creating one if missing).
 *   3. Upsert each anon cart_item into the permanent cart — when the same
 *      variant exists, sum the quantities.
 *   4. Mark the anon cart 'converted' and delete the anon customer row
 *      so it doesn't show up in admin queues. The anon auth.users row is
 *      left in place (Supabase doesn't bill for unused anon users; deleting
 *      requires the service-role API).
 *
 * Best-effort: returns ok with merged_items=0 + skipped=true if the anon
 * user had nothing to merge. Returns fail on policy violations only.
 */
export async function mergeAnonCart(
  input: z.input<typeof Schema>
): Promise<Result<MergeResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<MergeResult>("Invalid input", "INVALID_INPUT");
  }
  const anonUserId = parsed.data.anon_user_id;

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<MergeResult>("Not authenticated", "UNAUTHENTICATED");
  }
  // Caller must be a permanent account now — refuse if still anonymous.
  if (authData.user.is_anonymous) {
    return fail<MergeResult>(
      "Caller is still an anonymous user; refusing to merge.",
      "STILL_ANONYMOUS"
    );
  }
  const permUserId = authData.user.id;
  if (permUserId === anonUserId) {
    // Same uid — no merge needed (linkIdentity flow preserves uid).
    return ok({ merged_items: 0, skipped: true });
  }

  const admin = createAdminClient();

  // Verify the supplied uid is genuinely an anonymous user. Stops a
  // malicious client from naming someone else's permanent uid to siphon
  // their cart contents.
  const { data: anonAuthRow } = await admin
    .schema("auth" as never)
    .from("users")
    .select("id, is_anonymous")
    .eq("id", anonUserId)
    .maybeSingle();
  const anonAuth = anonAuthRow as { id: string; is_anonymous: boolean } | null;
  if (!anonAuth || !anonAuth.is_anonymous) {
    return fail<MergeResult>(
      "Supplied user id is not an anonymous user.",
      "NOT_ANONYMOUS"
    );
  }

  // Load anon cart and permanent cart in parallel.
  const [{ data: anonCartRow }, { data: permCartRow }] = await Promise.all([
    admin
      .from("carts")
      .select("id")
      .eq("user_id", anonUserId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("carts")
      .select("id")
      .eq("user_id", permUserId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const anonCart = anonCartRow as { id: string } | null;
  if (!anonCart) {
    return ok({ merged_items: 0, skipped: true });
  }

  // Resolve permanent cart, creating one if needed.
  let permCartId: string;
  if (permCartRow) {
    permCartId = (permCartRow as { id: string }).id;
  } else {
    const { data: created, error: createErr } = await admin
      .from("carts")
      .insert({ user_id: permUserId, status: "active" })
      .select("id")
      .single();
    if (createErr || !created) {
      return fail<MergeResult>(
        createErr?.message ?? "Permanent cart creation failed",
        createErr?.code ?? "CART_INSERT_FAILED"
      );
    }
    permCartId = (created as { id: string }).id;
  }

  // Fetch anon items and existing perm items in parallel.
  const [{ data: anonItemsRows }, { data: existingRows }] = await Promise.all([
    admin
      .from("cart_items")
      .select("id, product_id, variant_id, quantity, unit_price")
      .eq("cart_id", anonCart.id),
    admin
      .from("cart_items")
      .select("id, variant_id, quantity")
      .eq("cart_id", permCartId),
  ]);
  type ItemRow = {
    id: string;
    product_id: string;
    variant_id: string | null;
    quantity: number;
    unit_price: number | string;
  };
  const anonItems = (anonItemsRows ?? []) as ItemRow[];
  if (anonItems.length === 0) {
    return ok({ merged_items: 0, skipped: true });
  }

  // Existing perm items keyed by variant_id for the upsert merge.
  const existingByVariant = new Map<
    string,
    { id: string; quantity: number }
  >();
  for (const r of (existingRows ?? []) as Array<{
    id: string;
    variant_id: string | null;
    quantity: number;
  }>) {
    if (r.variant_id) existingByVariant.set(r.variant_id, r);
  }

  // Merge all anon items into the permanent cart in parallel.
  const mergeResults = await Promise.all(
    anonItems.map((item) => {
      const existing = item.variant_id
        ? existingByVariant.get(item.variant_id)
        : null;
      if (existing) {
        // Sum quantities. Subject to any product-level max-quantity rule the
        // CHECK constraints enforce; if violated, fall back to skipping that
        // line so the merge as a whole still succeeds.
        return admin
          .from("cart_items")
          .update({
            quantity: existing.quantity + item.quantity,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      return admin.from("cart_items").insert({
        cart_id: permCartId,
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      });
    })
  );
  const mergedCount = mergeResults.filter((r) => !r.error).length;

  // Mark the anon cart converted so it won't show up in any active-cart
  // queries. The cart_items rows are kept for historical reference.
  await admin
    .from("carts")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", anonCart.id);

  // Clean up the anon customer row (orphans the anon auth.users row, which
  // Supabase will GC eventually — we don't need to delete it explicitly).
  await admin.from("customers").delete().eq("auth_user_id", anonUserId);

  await logAuditEvent({
    actor_id: permUserId,
    actor_type: "user",
    action: "auth.anon_cart_merged",
    resource_type: "user",
    resource_id: permUserId,
    metadata: {
      anon_user_id: anonUserId,
      merged_items: mergedCount,
      anon_item_count: anonItems.length,
    },
  });

  revalidatePath("/cart");
  return ok({ merged_items: mergedCount, skipped: false });
}
