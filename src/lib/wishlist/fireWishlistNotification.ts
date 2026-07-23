import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { sendEmail } from "@/lib/email";
import { renderRestockNotification } from "@/lib/email/templates/restockNotification";
import { broadcastWishlistNotification } from "./broadcastNotification";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";

const WISHLIST_PRIORITY_HOLD_MINUTES = 30;

export type TriggeredBy =
  | "stripe_abandon"
  | "cod_cancel"
  | "supply_receipt"
  | "admin_topup"
  | "priority_hold_expired";

interface FireArgs {
  wishlist_item_id: string;
  variant_id: string;
  customer_id: string;
  /** Units to grant in the priority hold. Capped at the wishlist row's
   *  requested quantity by the caller. */
  quantity_to_hold: number;
  triggered_by: TriggeredBy;
  /** Phase 7: admin-supplied message that overrides the templated body
   *  (subject line stays templated). Used by `customMessageNotify`. */
  admin_message?: string | null;
}

export interface FireResult {
  success: boolean;
  /** Set on success; identifies the new priority_holds row. */
  priority_hold_id?: string;
  /** Set when success=false; categorical failure reason for the caller's UI. */
  reason?:
    | "INSUFFICIENT_INVENTORY"
    | "HOLD_INSERT_FAILED"
    | "EMAIL_FAILED"
    | "WISHLIST_NOT_FOUND"
    | "VARIANT_NOT_FOUND";
  error_message?: string;
}

/**
 * Phase 6/7 — fires a single wishlist notification in any mode.
 *
 * Atomic-ish workflow for one (subscriber, variant) pair:
 *   1. promote_to_priority(variant, qty) — moves inventory into the
 *      priority bucket; raises INSUFFICIENT_INVENTORY if drift happened
 *      since the caller's check.
 *   2. Insert priority_holds row (source='wishlist_notification', 30 min
 *      expiry). On failure, rolls back step 1 so inventory isn't
 *      stranded.
 *   3. Mark wishlist_items.notify_on_restock=false + last_notified_at
 *      (one-shot per spec §8.2 — customer can re-enable from /wishlist).
 *   4. Render + send the restock email. The `admin_message` override
 *      replaces the templated body for Phase 7 custom-message notifies;
 *      subject + structural elements stay templated.
 *   5. Audit log the action so admin queues / reporting have traceable
 *      history.
 *
 * Email delivery failure is reported but does NOT roll back the hold —
 * the customer still has 30 minutes to act if they're already on the
 * site (Realtime broadcast is the secondary channel, not implemented
 * yet — Phase 6 follow-up).
 *
 * Best-effort: never throws. Surfaces categorical reason for caller UX.
 */
export async function fireWishlistNotification(
  args: FireArgs
): Promise<FireResult> {
  const admin = createAdminClient();

  if (args.quantity_to_hold <= 0) {
    return { success: false, reason: "INSUFFICIENT_INVENTORY", error_message: "Quantity must be positive" };
  }

  // Step 1: atomic bucket move.
  const { error: holdErr } = await admin.rpc(
    "promote_to_priority" as never,
    { p_variant_id: args.variant_id, p_qty: args.quantity_to_hold } as never
  );
  if (holdErr) {
    return {
      success: false,
      reason: "INSUFFICIENT_INVENTORY",
      error_message: holdErr.message,
    };
  }

  // Step 2: insert tracking row. On failure, restore the bucket move.
  const expiresAt = new Date(
    Date.now() + WISHLIST_PRIORITY_HOLD_MINUTES * 60_000
  ).toISOString();
  const { data: holdRow, error: holdInsertErr } = await admin
    .from("priority_holds")
    .insert({
      variant_id: args.variant_id,
      customer_id: args.customer_id,
      quantity: args.quantity_to_hold,
      source: "wishlist_notification",
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (holdInsertErr || !holdRow) {
    await admin.rpc("release_priority" as never, {
      p_variant_id: args.variant_id,
      p_qty: args.quantity_to_hold,
    } as never);
    return {
      success: false,
      reason: "HOLD_INSERT_FAILED",
      error_message: holdInsertErr?.message ?? "priority_holds insert failed",
    };
  }
  const priorityHoldId = (holdRow as { id: string }).id;

  // Step 3: one-shot clear on the wishlist row.
  await admin
    .from("wishlist_items")
    .update({
      notify_on_restock: false,
      last_notified_at: new Date().toISOString(),
      last_notification_kind: "restock",
    })
    .eq("id", args.wishlist_item_id);

  // Step 4: render + send the email if the customer has an address on file.
  const ctx = await loadEmailContext(args.wishlist_item_id, args.customer_id);
  if (!ctx.wishlistRow || !ctx.variant || !ctx.product) {
    // Hold + flag flip already happened; fall back to "no email" success.
    return {
      success: true,
      priority_hold_id: priorityHoldId,
      reason: ctx.product ? "VARIANT_NOT_FOUND" : "WISHLIST_NOT_FOUND",
    };
  }

  let emailFailed = false;
  if (ctx.customer?.email) {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const rendered = renderRestockNotification({
      customer_first_name: ctx.customer.first_name,
      product_name: ctx.product.name,
      variant_label: ctx.variantLabel,
      product_url: `${baseUrl}/products/${ctx.product.slug}`,
      unsubscribe_url: `${baseUrl}/wishlist`,
      price_label: formatCurrency(
        ctx.price,
        ctx.customer.preferred_currency ?? "EUR"
      ),
      wishlisted_at: ctx.wishlistRow.created_at,
      hold_minutes: WISHLIST_PRIORITY_HOLD_MINUTES,
      image_url: ctx.imageUrl,
    });
    // Custom message override: replace text body, leave HTML
    // wrapper structure intact by re-rendering with the admin's prose
    // substituted in.
    const text = args.admin_message
      ? `${args.admin_message}\n\n— Παραγγείλετε τώρα: ${baseUrl}/products/${ctx.product.slug}`
      : rendered.text;
    const html = args.admin_message
      ? wrapAdminMessageHtml(args.admin_message, ctx.product.name, `${baseUrl}/products/${ctx.product.slug}`)
      : rendered.html;
    const result = await sendEmail({
      to: ctx.customer.email,
      subject: rendered.subject,
      text,
      html,
      templateId: args.admin_message ? "wishlist.restock_custom" : "wishlist.restock",
    });
    if (!result.success) emailFailed = true;
  }

  await logAuditEvent({
    actor_type: args.triggered_by === "stripe_abandon" || args.triggered_by === "cod_cancel" ? "system" : "user",
    action: args.admin_message ? "wishlist.notification.custom_fired" : "wishlist.notification.fired",
    resource_type: "wishlist_item",
    resource_id: args.wishlist_item_id,
    metadata: {
      variant_id: args.variant_id,
      customer_id: args.customer_id,
      quantity: args.quantity_to_hold,
      triggered_by: args.triggered_by,
      priority_hold_id: priorityHoldId,
      email_sent: !!ctx.customer?.email && !emailFailed,
    },
  });

  // Phase 6.5: live broadcast to the customer's channel. Best-effort —
  // never blocks the success path on broadcast delivery.
  if (ctx.product) {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    await broadcastWishlistNotification({
      customer_id: args.customer_id,
      variant_id: args.variant_id,
      product_name: ctx.product.name,
      product_url: `${baseUrl}/products/${ctx.product.slug}`,
      hold_expires_at: expiresAt,
      custom_message: !!args.admin_message,
    });
  }

  return emailFailed
    ? {
        success: true,
        priority_hold_id: priorityHoldId,
        reason: "EMAIL_FAILED",
        error_message: "Email send failed but hold is in place",
      }
    : { success: true, priority_hold_id: priorityHoldId };
}

interface EmailContext {
  wishlistRow: { created_at: string } | null;
  product: { name: string; slug: string } | null;
  variant: { id: string } | null;
  variantLabel: string | null;
  price: number;
  imageUrl: string | null;
  customer: {
    email: string | null;
    first_name: string | null;
    preferred_currency: string;
  } | null;
}

async function loadEmailContext(
  wishlistItemId: string,
  customerId: string
): Promise<EmailContext> {
  const admin = createAdminClient();

  const { data: wishRow } = await admin
    .from("wishlist_items")
    .select("created_at, variant_id, product_id")
    .eq("id", wishlistItemId)
    .maybeSingle();
  const wish = wishRow as
    | { created_at: string; variant_id: string | null; product_id: string }
    | null;
  if (!wish) {
    return {
      wishlistRow: null,
      product: null,
      variant: null,
      variantLabel: null,
      price: 0,
      imageUrl: null,
      customer: null,
    };
  }

  const [productRes, variantRes, customerRes] = await Promise.all([
    admin
      .from("products")
      .select("name, slug, base_price")
      .eq("id", wish.product_id)
      .maybeSingle(),
    wish.variant_id
      ? admin
          .from("product_variants")
          .select("id, attribute_combo, price")
          .eq("id", wish.variant_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("customers")
      .select("email, first_name, preferred_currency")
      .eq("id", customerId)
      .maybeSingle(),
  ]);

  const product = productRes.data as
    | { name: string; slug: string; base_price: number | string | null }
    | null;
  const variant = variantRes.data as
    | { id: string; attribute_combo: Record<string, string> | null; price: number | string | null }
    | null;
  const customer = customerRes.data as
    | { email: string | null; first_name: string | null; preferred_currency: string }
    | null;

  let variantLabel: string | null = null;
  if (variant?.attribute_combo) {
    const ids = Object.values(variant.attribute_combo);
    if (ids.length > 0) {
      const { data: vRows } = await admin
        .from("attribute_values")
        .select("id, value")
        .in("id", ids);
      const byId = new Map(
        ((vRows ?? []) as Array<{ id: string; value: string }>).map((r) => [r.id, r.value])
      );
      const labels = ids.map((id) => byId.get(id)).filter(Boolean) as string[];
      variantLabel = labels.length > 0 ? labels.join(" · ") : null;
    }
  }
  const price = variant
    ? Number(variant.price ?? 0)
    : Number(product?.base_price ?? 0);

  // Best-effort image lookup (variant-scoped first, then general).
  let imageUrl: string | null = null;
  if (product) {
    const { data: imgRows } = await admin
      .from("product_images")
      .select("url, variant_id, is_primary")
      .eq("product_id", wish.product_id)
      .order("is_primary", { ascending: false })
      .limit(20);
    const images = (imgRows ?? []) as Array<{
      url: string;
      variant_id: string | null;
      is_primary: boolean;
    }>;
    imageUrl =
      images.find((i) => i.variant_id === wish.variant_id)?.url ??
      images.find((i) => i.variant_id === null)?.url ??
      null;
  }

  return {
    wishlistRow: wish,
    product: product ? { name: product.name, slug: product.slug } : null,
    variant: variant ? { id: variant.id } : null,
    variantLabel,
    price,
    imageUrl,
    customer,
  };
}

function wrapAdminMessageHtml(
  message: string,
  productName: string,
  productUrl: string
): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  const escapedName = productName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const escapedUrl = productUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="el"><body style="font-family: system-ui, sans-serif; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>${escaped}</p>
  <p style="text-align:center; margin: 24px 0;">
    <a href="${escapedUrl}" style="display:inline-block; background:#1a1a1a; color:#fff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:600;">${escapedName} →</a>
  </p>
</body></html>`;
}
