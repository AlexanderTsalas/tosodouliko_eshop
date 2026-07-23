import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { CartWithItems, CartItemWithProduct } from "@/types/shopping-cart";

/**
 * Returns the current user's active cart with items joined to products.
 * Reads only — never accepts price or quantity overrides.
 */
export async function getCart(): Promise<Result<CartWithItems | null>> {
  const supabase = await createClient();

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok(null);

  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("user_id", authData.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (cartError) return fail<CartWithItems | null>(cartError.message, cartError.code);
  if (!cart) return ok(null);

  const { data: itemsRaw, error: itemsError } = await supabase
    .from("cart_items")
    .select(
      "id, cart_id, product_id, variant_id, quantity, unit_price, modifier_total, created_at, " +
        "products(name, slug), product_variants(sku, attribute_combo)"
    )
    .eq("cart_id", (cart as any).id);

  if (itemsError) return fail<CartWithItems | null>(itemsError.message, itemsError.code);

  const items: CartItemWithProduct[] = (itemsRaw ?? []).map((row: any) => ({
    id: row.id,
    cart_id: row.cart_id,
    product_id: row.product_id,
    variant_id: row.variant_id,
    quantity: row.quantity,
    unit_price: Number(row.unit_price),
    modifier_total: Number(row.modifier_total) || 0,
    created_at: row.created_at,
    product_name: row.products?.name ?? "",
    product_slug: row.products?.slug ?? "",
    variant_label: row.product_variants?.sku,
  }));

  // Phase 8h: surface per-line custom-field summaries so the cart UI
  // can render the gift message / engraving / etc. that locked the
  // modifier_total into existence.
  if (items.length > 0) {
    const cartItemIds = items.map((i) => i.id);
    const { data: cfRows } = await supabase
      .from("cart_item_custom_fields")
      .select(
        "cart_item_id, field_id, value, contributed_price, " +
          "custom_fields(label_translations, data_type)"
      )
      .in("cart_item_id", cartItemIds);
    type CFRow = {
      cart_item_id: string;
      field_id: string;
      value: unknown;
      contributed_price: number | string;
      custom_fields:
        | { label_translations: Record<string, string>; data_type: string }
        | Array<{
            label_translations: Record<string, string>;
            data_type: string;
          }>
        | null;
    };
    const valueRowsRes =
      cfRows && (cfRows as unknown as CFRow[]).length > 0
        ? await supabase
            .from("custom_field_values")
            .select("field_id, value, label_translations")
            .in(
              "field_id",
              Array.from(
                new Set((cfRows as unknown as CFRow[]).map((r) => r.field_id))
              )
            )
        : { data: [] };
    type VRow = {
      field_id: string;
      value: unknown;
      label_translations: Record<string, string>;
    };
    const valueLabelsByField = new Map<
      string,
      Map<string, string>
    >();
    for (const v of (valueRowsRes.data ?? []) as VRow[]) {
      const map =
        valueLabelsByField.get(v.field_id) ?? new Map<string, string>();
      const valueKey =
        typeof v.value === "string"
          ? v.value
          : typeof v.value === "boolean"
            ? String(v.value)
            : JSON.stringify(v.value);
      const label =
        v.label_translations?.el ?? v.label_translations?.en ?? valueKey;
      map.set(valueKey, label);
      valueLabelsByField.set(v.field_id, map);
    }
    const cfByItem = new Map<
      string,
      Array<{
        field_id: string;
        field_label: string;
        display_value: string;
        contributed_price: number;
      }>
    >();
    for (const row of (cfRows ?? []) as unknown as CFRow[]) {
      const meta = Array.isArray(row.custom_fields)
        ? row.custom_fields[0]
        : row.custom_fields;
      if (!meta) continue;
      const fieldLabel =
        meta.label_translations?.el ??
        meta.label_translations?.en ??
        row.field_id;
      const valueLabels = valueLabelsByField.get(row.field_id) ?? new Map();
      let display: string;
      switch (meta.data_type) {
        case "boolean":
          display =
            valueLabels.get(String(Boolean(row.value))) ??
            (row.value ? "Ναι" : "Όχι");
          break;
        case "dropdown":
          display =
            valueLabels.get(String(row.value)) ?? String(row.value);
          break;
        case "multi_select":
          if (Array.isArray(row.value)) {
            display = (row.value as string[])
              .map((k) => valueLabels.get(k) ?? k)
              .join(", ");
          } else {
            display = "—";
          }
          break;
        case "text":
        case "number":
          display = String(row.value ?? "—");
          break;
        default:
          display = JSON.stringify(row.value);
      }
      const arr = cfByItem.get(row.cart_item_id) ?? [];
      arr.push({
        field_id: row.field_id,
        field_label: fieldLabel,
        display_value: display,
        contributed_price: Number(row.contributed_price) || 0,
      });
      cfByItem.set(row.cart_item_id, arr);
    }
    for (const item of items) {
      const list = cfByItem.get(item.id);
      if (list && list.length > 0) item.custom_fields = list;
    }
  }

  // Phase 4: surface soft-wait queue membership per cart item. RLS scopes
  // both soft_waits and priority_holds to the caller's own customer, so
  // we can fetch them directly via the user client.
  if (items.length > 0) {
    const ids = items.map((i) => i.id);
    const { data: waitRows } = await supabase
      .from("soft_waits")
      .select("id, cart_item_id, promoted_at, variant_id, checkout_session_id, created_at")
      .in("cart_item_id", ids);
    type WaitRow = {
      id: string;
      cart_item_id: string;
      promoted_at: string | null;
      variant_id: string;
      checkout_session_id: string;
      created_at: string;
    };
    const waits = (waitRows ?? []) as WaitRow[];
    const waitByItem = new Map(waits.map((w) => [w.cart_item_id, w]));

    // Promoted-variant priority holds + pending-queue positions are
    // independent of each other (both derive from `waits` only). Run
    // them in parallel to shave one round-trip off cart render.
    // Phase 9 of the data-layer remediation.
    const promotedVariantIds = waits
      .filter((w) => w.promoted_at !== null)
      .map((w) => w.variant_id);
    const pendingSessionIds = waits.some((w) => !w.promoted_at)
      ? Array.from(
          new Set(waits.filter((w) => !w.promoted_at).map((w) => w.checkout_session_id))
        )
      : [];

    const adminClient =
      pendingSessionIds.length > 0
        ? (await import("@/lib/supabase/admin")).createAdminClient()
        : null;

    const [holdRowsRes, allPendingRes] = await Promise.all([
      promotedVariantIds.length > 0
        ? supabase
            .from("priority_holds")
            .select("variant_id, expires_at, consumed_at")
            .in("variant_id", promotedVariantIds)
            .is("consumed_at", null)
        : Promise.resolve({ data: null }),
      pendingSessionIds.length > 0 && adminClient
        ? adminClient
            .from("soft_waits")
            .select("checkout_session_id, created_at")
            .in("checkout_session_id", pendingSessionIds)
            .is("promoted_at", null)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: null }),
    ]);

    const holdByVariant = new Map<string, string>();
    for (const h of (holdRowsRes.data ?? []) as Array<{
      variant_id: string;
      expires_at: string;
    }>) {
      holdByVariant.set(h.variant_id, h.expires_at);
    }

    const pendingByCustomerSessions = new Map<string, string[]>();
    for (const r of (allPendingRes.data ?? []) as Array<{
      checkout_session_id: string;
      created_at: string;
    }>) {
      const arr = pendingByCustomerSessions.get(r.checkout_session_id) ?? [];
      arr.push(r.created_at);
      pendingByCustomerSessions.set(r.checkout_session_id, arr);
    }

    for (const item of items) {
      const w = waitByItem.get(item.id);
      if (!w) continue;
      if (w.promoted_at) {
        item.wait_state = "promoted";
        const exp = holdByVariant.get(w.variant_id);
        if (exp) item.priority_expires_at = exp;
      } else {
        item.wait_state = "pending";
        item.soft_wait_id = w.id;
        const queue = pendingByCustomerSessions.get(w.checkout_session_id) ?? [];
        const idx = queue.indexOf(w.created_at);
        item.queue_position = idx === -1 ? undefined : idx + 1;
      }
    }
  }

  return ok({ ...(cart as any), items } as CartWithItems);
}
