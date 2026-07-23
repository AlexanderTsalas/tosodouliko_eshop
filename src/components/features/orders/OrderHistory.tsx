import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/multi-currency";
import type { Order } from "@/types/order-history";

/**
 * Server component listing the current user's orders, newest first.
 * Renders nothing if not authenticated.
 */
export default async function OrderHistory() {
  const supabase = await createClient();

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return (
      <p className="text-muted-foreground">
        Συνδεθείτε για να δείτε το ιστορικό παραγγελιών.
      </p>
    );
  }

  // Resolve the caller's customer row (1:1 with auth user). A signed-in user
  // may not have a customers row yet if they never placed an order — show
  // empty state in that case.
  const { data: customerRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (customerRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return <p className="text-muted-foreground">Δεν έχετε παραγγελίες ακόμη.</p>;
  }

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return <p className="text-destructive">Σφάλμα φόρτωσης παραγγελιών.</p>;
  }

  const orders = (data ?? []) as Order[];
  if (orders.length === 0) {
    return <p className="text-muted-foreground">Δεν έχετε παραγγελίες ακόμη.</p>;
  }

  return (
    <ul className="space-y-3">
      {orders.map((o) => (
        <li
          key={o.id}
          className="border border-stone-taupe/15 rounded-sm bg-card hover:border-stone-taupe/30 hover:shadow-sm transition-all"
        >
          <Link
            href={`/orders/${o.id}`}
            className="group flex items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <span className="font-serif font-bold text-ink group-hover:text-terracotta transition-colors">
                {o.order_number}
              </span>
              <p className="text-sm text-muted-foreground">
                {new Date(o.created_at).toLocaleDateString("el-GR")} · {o.fulfillment_status}
              </p>
            </div>
            <span className="font-mono font-bold text-ink">
              {formatCurrency(Number(o.total), o.currency)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
