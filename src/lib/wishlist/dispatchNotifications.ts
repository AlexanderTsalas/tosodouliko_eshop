import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { sendBatch } from "@/lib/email/batchSender";
import { renderRestockNotification } from "@/lib/email/templates/restockNotification";
import { broadcastWishlistNotification } from "./broadcastNotification";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import type { SendEmailInput } from "@/lib/email";

const WISHLIST_PRIORITY_HOLD_MINUTES = 30;
type TriggeredBy =
  | "stripe_abandon"
  | "cod_cancel"
  | "supply_receipt"
  | "admin_topup"
  | "priority_hold_expired";

interface Args {
  variant_id: string;
  /**
   * The number of units that just became available. Used to decide
   * sequential-vs-parallel cadence per spec §9.4 — when this is enough
   * to cover all queued subscribers' requested_quantity, we fire all
   * notifications simultaneously; otherwise we fire FIFO and let the
   * priority-hold reaper advance the queue.
   */
  released_qty: number;
  triggered_by: TriggeredBy;
}

interface DispatchResult {
  /** Number of subscribers actually notified in this call. */
  notified: number;
  /** Number of subscribers enqueued for admin review (manual mode). */
  enqueued: number;
  /** Number of subscribers skipped because inventory ran out mid-batch. */
  skipped: number;
}

/**
 * Phase 6 dispatcher. Called after a release path frees inventory for a
 * variant (Stripe expire/fail, admin top-up, COD cancel, supply receipt,
 * priority-hold expiry).
 *
 * Steps:
 *   1. Read notification_settings.wishlist_notification_mode.
 *   2. Find FIFO subscribers (wishlist_items.notify_on_restock=true) for
 *      the variant.
 *   3. Manual mode: insert pending_wishlist_notifications rows, return.
 *      Phase 7's admin queue UI processes them.
 *   4. Automated mode: apply sequential/parallel cadence rule.
 *      - parallel (released_qty >= queue_demand): notify ALL subscribers
 *        at once. Each gets a 30-min priority_hold for their requested
 *        quantity, email + Realtime broadcast (Realtime in Phase 6.5).
 *      - sequential (released_qty < queue_demand): notify the first FIFO
 *        subscriber, hold the available qty for them. The priority-hold
 *        reaper advances the queue on expiry (TODO Phase 6 follow-up:
 *        wire `release_expired_priority_holds` to re-call dispatcher
 *        for wishlist_notification source rows).
 *   5. On a successful notify, set `notify_on_restock=false` and update
 *      `last_notified_at` / `last_notification_kind` on the wishlist row
 *      (one-shot per spec §8.2; customer can re-enable from their
 *      account).
 *
 * Never throws — the caller is typically a webhook handler that must
 * acknowledge the upstream event regardless of dispatcher state. Errors
 * are audit-logged.
 */
export async function dispatchWishlistNotifications(
  args: Args
): Promise<DispatchResult> {
  const result: DispatchResult = { notified: 0, enqueued: 0, skipped: 0 };
  if (args.released_qty <= 0) return result;
  const admin = createAdminClient();

  try {
    type WishRow = {
      id: string;
      customer_id: string;
      quantity: number;
      created_at: string;
    };
    const [{ data: modeRow }, { data: subsRaw }] = await Promise.all([
      admin
        .from("notification_settings")
        .select("wishlist_notification_mode")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("wishlist_items")
        .select("id, customer_id, quantity, created_at")
        .eq("variant_id", args.variant_id)
        .eq("notify_on_restock", true)
        .order("created_at", { ascending: true }),
    ]);
    const mode =
      (modeRow as { wishlist_notification_mode: "automated" | "manual" } | null)
        ?.wishlist_notification_mode ?? "automated";
    const subscribers = (subsRaw ?? []) as WishRow[];
    if (subscribers.length === 0) return result;

    if (mode === "manual") {
      const rows = subscribers.map((s) => ({
        wishlist_item_id: s.id,
        variant_id: args.variant_id,
        customer_id: s.customer_id,
        quantity_to_offer: Math.min(s.quantity, args.released_qty),
        triggered_by: args.triggered_by,
      }));
      const { error } = await admin
        .from("pending_wishlist_notifications")
        .insert(rows);
      if (error) {
        console.error(`[dispatchWishlistNotifications] enqueue failed: ${error.message}`);
        return result;
      }
      result.enqueued = rows.length;
      await logAuditEvent({
        actor_type: "system",
        action: "wishlist.notifications.enqueued",
        resource_type: "product_variant",
        resource_id: args.variant_id,
        metadata: {
          enqueued: rows.length,
          triggered_by: args.triggered_by,
          released_qty: args.released_qty,
        },
      });
      return result;
    }

    // Automated mode. Decide cadence.
    const queueDemand = subscribers.reduce((sum, s) => sum + Math.max(1, s.quantity), 0);
    const parallel = args.released_qty >= queueDemand;
    const toNotify = parallel ? subscribers : [subscribers[0]];

    // Gather the data the email template + product URL need. Single query
    // for the variant + product, single query for customers.
    const variantInfo = await loadVariantInfo(args.variant_id);
    if (!variantInfo) {
      console.error(
        `[dispatchWishlistNotifications] variant info missing for ${args.variant_id}`
      );
      return result;
    }
    const customerIds = toNotify.map((s) => s.customer_id);
    const { data: custsRaw } = await admin
      .from("customers")
      .select("id, email, first_name, preferred_currency")
      .in("id", customerIds);
    const custById = new Map(
      ((custsRaw ?? []) as Array<{
        id: string;
        email: string | null;
        first_name: string | null;
        preferred_currency: string;
      }>).map((c) => [c.id, c])
    );

    let remaining = args.released_qty;
    const emails: SendEmailInput[] = [];
    const successfulSubIds: string[] = [];

    for (const sub of toNotify) {
      const holdQty = Math.min(sub.quantity, remaining);
      if (holdQty <= 0) {
        result.skipped += 1;
        continue;
      }
      // Atomic priority hold. If inventory drifted between our SELECT and
      // here, the hold fails and we skip this subscriber.
      const { error: holdErr } = await admin.rpc(
        "promote_to_priority" as never,
        { p_variant_id: args.variant_id, p_qty: holdQty } as never
      );
      if (holdErr) {
        result.skipped += 1;
        continue;
      }
      const expiresAt = new Date(
        Date.now() + WISHLIST_PRIORITY_HOLD_MINUTES * 60_000
      ).toISOString();
      const { error: holdInsertErr } = await admin
        .from("priority_holds")
        .insert({
          variant_id: args.variant_id,
          customer_id: sub.customer_id,
          quantity: holdQty,
          source: "wishlist_notification",
          expires_at: expiresAt,
        });
      if (holdInsertErr) {
        // Inventory was moved but the tracking row failed — roll back the
        // bucket move so the inventory isn't stranded.
        await admin.rpc("release_priority" as never, {
          p_variant_id: args.variant_id,
          p_qty: holdQty,
        } as never);
        result.skipped += 1;
        continue;
      }
      remaining -= holdQty;
      successfulSubIds.push(sub.id);

      // Phase 6.5: Realtime broadcast to the customer's channel.
      const baseUrlForBroadcast =
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
      await broadcastWishlistNotification({
        customer_id: sub.customer_id,
        variant_id: args.variant_id,
        product_name: variantInfo.product_name,
        product_url: `${baseUrlForBroadcast}/products/${variantInfo.product_slug}`,
        hold_expires_at: expiresAt,
        custom_message: false,
      });

      const cust = custById.get(sub.customer_id);
      if (cust?.email) {
        const baseUrl =
          process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
        const rendered = renderRestockNotification({
          customer_first_name: cust.first_name,
          product_name: variantInfo.product_name,
          variant_label: variantInfo.variant_label,
          product_url: `${baseUrl}/products/${variantInfo.product_slug}`,
          unsubscribe_url: `${baseUrl}/account/wishlist`,
          price_label: formatCurrency(
            variantInfo.price,
            cust.preferred_currency ?? "EUR"
          ),
          wishlisted_at: sub.created_at,
          hold_minutes: WISHLIST_PRIORITY_HOLD_MINUTES,
          image_url: variantInfo.image_url,
        });
        emails.push({
          to: cust.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          templateId: "wishlist.restock",
        });
      }
    }

    if (successfulSubIds.length > 0) {
      // Per spec §8.2, notify_on_restock is one-shot. Clear the flag and
      // record the notification on each successfully-held subscriber.
      const nowIso = new Date().toISOString();
      await admin
        .from("wishlist_items")
        .update({
          notify_on_restock: false,
          last_notified_at: nowIso,
          last_notification_kind: "restock",
        })
        .in("id", successfulSubIds);
    }

    if (emails.length > 0) {
      const batch = await sendBatch(emails);
      result.notified = batch.succeeded;
      if (batch.failed > 0) {
        console.error(
          `[dispatchWishlistNotifications] ${batch.failed}/${batch.attempted} sends failed: ${batch.sampleErrors.join(" | ")}`
        );
      }
    } else {
      // Held inventory but no email addresses on file. Still count holds as
      // "notified" attempts so the audit metadata makes sense.
      result.notified = successfulSubIds.length;
    }

    await logAuditEvent({
      actor_type: "system",
      action: "wishlist.notifications.dispatched",
      resource_type: "product_variant",
      resource_id: args.variant_id,
      metadata: {
        cadence: parallel ? "parallel" : "sequential",
        notified: result.notified,
        skipped: result.skipped,
        triggered_by: args.triggered_by,
        released_qty: args.released_qty,
        subscribers_in_queue: subscribers.length,
      },
    });
  } catch (err) {
    console.error(
      `[dispatchWishlistNotifications] unexpected error: ${(err as Error).message}`
    );
  }

  return result;
}

interface VariantInfo {
  product_name: string;
  product_slug: string;
  variant_label: string | null;
  price: number;
  image_url: string | null;
}

async function loadVariantInfo(variantId: string): Promise<VariantInfo | null> {
  const admin = createAdminClient();
  const { data: variant } = await admin
    .from("product_variants")
    .select(
      "id, price, attribute_combo, product_id, products(name, slug)"
    )
    .eq("id", variantId)
    .maybeSingle();
  if (!variant) return null;
  const v = variant as {
    id: string;
    price: number | string;
    attribute_combo: Record<string, string> | null;
    product_id: string;
    products: { name: string; slug: string } | { name: string; slug: string }[] | null;
  };
  const product = Array.isArray(v.products) ? v.products[0] : v.products;
  if (!product) return null;

  let variantLabel: string | null = null;
  if (v.attribute_combo) {
    const ids = Object.values(v.attribute_combo);
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

  // Best-effort primary image lookup (variant-specific first, then general).
  const { data: imgRows } = await admin
    .from("product_images")
    .select("url, variant_id, is_primary, display_order")
    .eq("product_id", v.product_id)
    .order("is_primary", { ascending: false })
    .order("display_order", { ascending: true })
    .limit(20);
  const images = (imgRows ?? []) as Array<{
    url: string;
    variant_id: string | null;
    is_primary: boolean;
  }>;
  const image_url =
    images.find((i) => i.variant_id === variantId)?.url ??
    images.find((i) => i.variant_id === null)?.url ??
    null;

  return {
    product_name: product.name,
    product_slug: product.slug,
    variant_label: variantLabel,
    price: Number(v.price),
    image_url,
  };
}
