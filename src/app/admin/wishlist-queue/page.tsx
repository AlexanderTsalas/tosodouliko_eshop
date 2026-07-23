import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import WishlistQueueModeToggle from "@/components/admin/wishlist-queue/WishlistQueueModeToggle";
import WishlistQueueTabs from "@/components/admin/wishlist-queue/WishlistQueueTabs";
import {
  type PendingRow,
  type VariantInfo,
  type EnrichedPendingRow,
} from "@/components/admin/wishlist-queue/WishlistQueueGroup";
import {
  type SubscriberRow,
  type SubscriberVariantInfo,
} from "@/components/admin/wishlist-queue/WishlistSubscribersGroup";

export const metadata = { title: "Λίστα αναμονής — Admin" };
export const dynamic = "force-dynamic";

export default async function WishlistQueuePage() {
  await requirePermission("manage:wishlist_queue");
  const admin = createAdminClient();

  // Pull mode + pending notification rows + every active subscriber in parallel.
  // Both pending and subscriber rows now reference customer_id directly (since
  // 20260601000006), so customer enrichment is a single lookup.
  const [
    { data: modeRow },
    { data: pendingRowsRaw },
    { data: subscriberRowsRaw },
  ] = await Promise.all([
    admin
      .from("notification_settings")
      .select("wishlist_notification_mode")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("pending_wishlist_notifications")
      .select(
        "id, wishlist_item_id, variant_id, customer_id, quantity_to_offer, triggered_by, triggered_at"
      )
      .eq("status", "pending")
      .order("triggered_at", { ascending: true }),
    admin
      .from("wishlist_items")
      .select("id, customer_id, variant_id, quantity, source, created_at")
      .eq("notify_on_restock", true)
      .not("variant_id", "is", null)
      .order("created_at", { ascending: true }),
  ]);

  const mode =
    (modeRow as { wishlist_notification_mode: "automated" | "manual" } | null)
      ?.wishlist_notification_mode ?? "automated";
  const pendingRows = (pendingRowsRaw ?? []) as PendingRow[];

  type SubRaw = {
    id: string;
    customer_id: string;
    variant_id: string;
    quantity: number;
    source: string;
    created_at: string;
  };
  const subscriberRows = (subscriberRowsRaw ?? []) as SubRaw[];

  // Union of variant ids across both sources, so a variant in either list
  // only needs one lookup for product/inventory data.
  const variantIds = Array.from(
    new Set([
      ...pendingRows.map((r) => r.variant_id),
      ...subscriberRows.map((r) => r.variant_id),
    ])
  );
  const customerIds = Array.from(
    new Set([
      ...pendingRows.map((r) => r.customer_id),
      ...subscriberRows.map((r) => r.customer_id),
    ])
  );

  const [variantsRes, customersRes, inventoryRes] = await Promise.all([
    variantIds.length > 0
      ? admin
          .from("product_variants")
          .select(
            "id, attribute_combo, product_id, products(name, slug)"
          )
          .in("id", variantIds)
      : Promise.resolve({ data: [] as never[] }),
    customerIds.length > 0
      ? admin
          .from("customers")
          .select("id, email, first_name, last_name")
          .in("id", customerIds)
      : Promise.resolve({ data: [] as never[] }),
    variantIds.length > 0
      ? admin
          .from("inventory_items")
          .select("variant_id, quantity_available")
          .in("variant_id", variantIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  type VariantRow = {
    id: string;
    attribute_combo: Record<string, string> | null;
    product_id: string;
    products: { name: string; slug: string } | { name: string; slug: string }[] | null;
  };
  type CustomerRow = {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  type InvRow = { variant_id: string; quantity_available: number };

  const variants = (variantsRes.data ?? []) as VariantRow[];
  const customers = (customersRes.data ?? []) as CustomerRow[];
  const inventory = (inventoryRes.data ?? []) as InvRow[];

  // Batch-resolve attribute_combo value UUIDs.
  const allValueIds = new Set<string>();
  for (const v of variants) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) allValueIds.add(id);
  }
  const valueLabelById = new Map<string, string>();
  if (allValueIds.size > 0) {
    const { data: vRows } = await admin
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(allValueIds));
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  const variantById = new Map<string, VariantInfo>();
  for (const v of variants) {
    const product = Array.isArray(v.products) ? v.products[0] : v.products;
    let variantLabel: string | null = null;
    if (v.attribute_combo) {
      const labels = Object.values(v.attribute_combo)
        .map((id) => valueLabelById.get(id))
        .filter((s): s is string => typeof s === "string");
      if (labels.length > 0) variantLabel = labels.join(" · ");
    }
    variantById.set(v.id, {
      variant_id: v.id,
      product_id: v.product_id,
      product_name: product?.name ?? "(άγνωστο)",
      product_slug: product?.slug ?? "",
      variant_label: variantLabel,
      available_now: 0,
    });
  }
  for (const inv of inventory) {
    const existing = variantById.get(inv.variant_id);
    if (existing) existing.available_now = inv.quantity_available;
  }

  const customerById = new Map(customers.map((c) => [c.id, c]));

  function customerName(c: CustomerRow | undefined): string | null {
    if (!c) return null;
    if (!c.first_name && !c.last_name) return null;
    return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  }

  // -------- Pending groups (dispatcher decisions) --------
  const pendingGrouped = new Map<string, PendingRow[]>();
  for (const row of pendingRows) {
    const list = pendingGrouped.get(row.variant_id) ?? [];
    list.push(row);
    pendingGrouped.set(row.variant_id, list);
  }
  const pendingGroups = Array.from(pendingGrouped.entries()).map(
    ([variantId, rows]) => {
      const info = variantById.get(variantId) ?? {
        variant_id: variantId,
        product_id: "",
        product_name: "(άγνωστο)",
        product_slug: "",
        variant_label: null,
        available_now: 0,
      };
      const enrichedRows: EnrichedPendingRow[] = rows.map((r, idx) => {
        const cust = customerById.get(r.customer_id);
        return {
          ...r,
          queue_position: idx + 1,
          customer_email: cust?.email ?? null,
          customer_name: customerName(cust),
        };
      });
      return { info, rows: enrichedRows };
    }
  );

  // -------- Subscriber groups (raw waiter list) --------
  const subscriberGrouped = new Map<string, SubRaw[]>();
  for (const row of subscriberRows) {
    const list = subscriberGrouped.get(row.variant_id) ?? [];
    list.push(row);
    subscriberGrouped.set(row.variant_id, list);
  }
  const subscriberGroups = Array.from(subscriberGrouped.entries()).map(
    ([variantId, rows]) => {
      const baseInfo = variantById.get(variantId) ?? {
        variant_id: variantId,
        product_id: "",
        product_name: "(άγνωστο)",
        product_slug: "",
        variant_label: null,
        available_now: 0,
      };
      const info: SubscriberVariantInfo = { ...baseInfo };
      const enrichedRows: SubscriberRow[] = rows.map((r) => {
        const cust = customerById.get(r.customer_id);
        return {
          id: r.id,
          customer_id: r.customer_id,
          customer_email: cust?.email ?? null,
          customer_name: customerName(cust),
          quantity: r.quantity,
          source: r.source,
          created_at: r.created_at,
        };
      });
      return { info, rows: enrichedRows };
    }
  );

  return (
    <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Λίστα αναμονής ειδοποιήσεων</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Πελάτες που περιμένουν ειδοποίηση για επιστροφή αποθέματος. Η
            καρτέλα <strong>Εκκρεμείς</strong> δείχνει αυτούς που πρέπει να
            ειδοποιήσετε χειροκίνητα (όταν επιστρέψει απόθεμα). Η καρτέλα{" "}
            <strong>Συνδρομητές</strong> δείχνει όλους όσοι έχουν εγγραφεί για
            ειδοποίηση από όπου κι αν προήλθε η εγγραφή.
          </p>
        </header>

        <WishlistQueueModeToggle currentMode={mode} />

        <WishlistQueueTabs
          pendingGroups={pendingGroups}
          subscriberGroups={subscriberGroups}
        />
    </div>
  );
}
