import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import InventoryDebugView from "@/components/admin/inventory-debug/InventoryDebugView";

export const metadata = { title: "Inventory debug — Admin" };
export const dynamic = "force-dynamic";

interface SoftSession {
  id: string;
  customer_id: string;
  customer_email: string | null;
  customer_name: string | null;
  state: string;
  expires_at: string;
  last_heartbeat_at: string | null;
  cart_quantity: number;
}

interface PriorityHold {
  id: string;
  customer_id: string;
  customer_email: string | null;
  customer_name: string | null;
  source: "soft_wait_promotion" | "wishlist_notification";
  quantity: number;
  expires_at: string;
}

interface SoftWait {
  id: string;
  customer_id: string;
  customer_email: string | null;
  customer_name: string | null;
  checkout_session_id: string;
  quantity: number;
  promoted_at: string | null;
  created_at: string;
}

interface DebugSnapshot {
  variant: {
    id: string;
    sku: string;
    label: string | null;
    product_name: string;
    product_slug: string;
  } | null;
  inventory: {
    quantity_available: number;
    quantity_reserved: number;
    quantity_soft_held: number;
    quantity_priority_held: number;
  } | null;
  soft_sessions: SoftSession[];
  priority_holds: PriorityHold[];
  soft_waits: SoftWait[];
  notify_subscriber_count: number;
}

export default async function InventoryDebugPage(
  props: {
    searchParams: Promise<{ variant?: string; sku?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requirePermission("manage:orders");
  const admin = createAdminClient();

  let snapshot: DebugSnapshot | null = null;
  const query = (searchParams.variant ?? searchParams.sku ?? "").trim();

  if (query) {
    // Resolve variant: try as uuid first, then SKU.
    const isUuid = /^[0-9a-f-]{36}$/i.test(query);
    const { data: variantRow } = isUuid
      ? await admin
          .from("product_variants")
          .select("id, sku, attribute_combo, product_id, products(name, slug)")
          .eq("id", query)
          .maybeSingle()
      : await admin
          .from("product_variants")
          .select("id, sku, attribute_combo, product_id, products(name, slug)")
          .eq("sku", query)
          .maybeSingle();

    type V = {
      id: string;
      sku: string;
      attribute_combo: Record<string, string> | null;
      product_id: string;
      products: { name: string; slug: string } | { name: string; slug: string }[] | null;
    };
    const variant = variantRow as V | null;

    if (variant) {
      const product = Array.isArray(variant.products) ? variant.products[0] : variant.products;
      let variantLabel: string | null = null;
      if (variant.attribute_combo) {
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

      const [
        { data: inv },
        { data: sessRows },
        { data: holdRows },
        { data: waitRows },
        notifyCountRes,
      ] = await Promise.all([
        admin
          .from("inventory_items")
          .select(
            "quantity_available, quantity_reserved, quantity_soft_held, quantity_priority_held"
          )
          .eq("variant_id", variant.id)
          .maybeSingle(),
        admin
          .from("cart_checkout_sessions")
          .select(
            "id, customer_id, state, expires_at, last_heartbeat_at, cart_id, customers(email, first_name, last_name)"
          )
          .in("state", ["soft", "hard"])
          .order("expires_at", { ascending: true }),
        admin
          .from("priority_holds")
          .select(
            "id, customer_id, source, quantity, expires_at, customers(email, first_name, last_name)"
          )
          .eq("variant_id", variant.id)
          .is("consumed_at", null)
          .order("expires_at", { ascending: true }),
        admin
          .from("soft_waits")
          .select(
            "id, customer_id, checkout_session_id, quantity, promoted_at, created_at, customers(email, first_name, last_name)"
          )
          .eq("variant_id", variant.id)
          .order("created_at", { ascending: true }),
        admin
          .from("wishlist_items")
          .select("id", { count: "exact", head: true })
          .eq("variant_id", variant.id)
          .eq("notify_on_restock", true),
      ]);

      // Filter sessions to only those whose cart contains this variant.
      type SessRaw = {
        id: string;
        customer_id: string;
        state: string;
        expires_at: string;
        last_heartbeat_at: string | null;
        cart_id: string | null;
        customers:
          | { email: string | null; first_name: string | null; last_name: string | null }
          | { email: string | null; first_name: string | null; last_name: string | null }[]
          | null;
      };
      const allSessions = (sessRows ?? []) as SessRaw[];
      const cartIds = allSessions
        .map((s) => s.cart_id)
        .filter((id): id is string => Boolean(id));
      const sessionsByCart = new Map<string, SessRaw>();
      for (const s of allSessions) {
        if (s.cart_id) sessionsByCart.set(s.cart_id, s);
      }
      const { data: matchingItems } =
        cartIds.length > 0
          ? await admin
              .from("cart_items")
              .select("cart_id, quantity")
              .in("cart_id", cartIds)
              .eq("variant_id", variant.id)
              .gt("quantity", 0)
          : { data: [] as Array<{ cart_id: string; quantity: number }> };
      const cartQtyById = new Map(
        (matchingItems ?? []).map((mi: any) => [mi.cart_id, mi.quantity])
      );
      const softSessions: SoftSession[] = [];
      for (const s of allSessions) {
        if (!s.cart_id || !cartQtyById.has(s.cart_id)) continue;
        const cust = Array.isArray(s.customers) ? s.customers[0] : s.customers;
        softSessions.push({
          id: s.id,
          customer_id: s.customer_id,
          customer_email: cust?.email ?? null,
          customer_name:
            cust && (cust.first_name || cust.last_name)
              ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim()
              : null,
          state: s.state,
          expires_at: s.expires_at,
          last_heartbeat_at: s.last_heartbeat_at,
          cart_quantity: cartQtyById.get(s.cart_id) ?? 0,
        });
      }

      type HoldRaw = {
        id: string;
        customer_id: string;
        source: "soft_wait_promotion" | "wishlist_notification";
        quantity: number;
        expires_at: string;
        customers:
          | { email: string | null; first_name: string | null; last_name: string | null }
          | { email: string | null; first_name: string | null; last_name: string | null }[]
          | null;
      };
      const priorityHolds: PriorityHold[] = ((holdRows ?? []) as HoldRaw[]).map((h) => {
        const cust = Array.isArray(h.customers) ? h.customers[0] : h.customers;
        return {
          id: h.id,
          customer_id: h.customer_id,
          customer_email: cust?.email ?? null,
          customer_name:
            cust && (cust.first_name || cust.last_name)
              ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim()
              : null,
          source: h.source,
          quantity: h.quantity,
          expires_at: h.expires_at,
        };
      });

      type WaitRaw = {
        id: string;
        customer_id: string;
        checkout_session_id: string;
        quantity: number;
        promoted_at: string | null;
        created_at: string;
        customers:
          | { email: string | null; first_name: string | null; last_name: string | null }
          | { email: string | null; first_name: string | null; last_name: string | null }[]
          | null;
      };
      const softWaits: SoftWait[] = ((waitRows ?? []) as WaitRaw[]).map((w) => {
        const cust = Array.isArray(w.customers) ? w.customers[0] : w.customers;
        return {
          id: w.id,
          customer_id: w.customer_id,
          customer_email: cust?.email ?? null,
          customer_name:
            cust && (cust.first_name || cust.last_name)
              ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim()
              : null,
          checkout_session_id: w.checkout_session_id,
          quantity: w.quantity,
          promoted_at: w.promoted_at,
          created_at: w.created_at,
        };
      });

      snapshot = {
        variant: {
          id: variant.id,
          sku: variant.sku,
          label: variantLabel,
          product_name: product?.name ?? "(άγνωστο)",
          product_slug: product?.slug ?? "",
        },
        inventory: inv as DebugSnapshot["inventory"] | null,
        soft_sessions: softSessions,
        priority_holds: priorityHolds,
        soft_waits: softWaits,
        notify_subscriber_count: notifyCountRes.count ?? 0,
      };
    } else {
      snapshot = {
        variant: null,
        inventory: null,
        soft_sessions: [],
        priority_holds: [],
        soft_waits: [],
        notify_subscriber_count: 0,
      };
    }
  }

  return <InventoryDebugView query={query} snapshot={snapshot} />;
}
