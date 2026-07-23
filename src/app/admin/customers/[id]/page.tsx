import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import CustomerEditForm from "@/components/admin/customers/CustomerEditForm";
import CustomerDuplicatesSection, {
  type DuplicateSuggestion,
} from "@/components/admin/customers/CustomerDuplicatesSection";
import { findCustomerMatches } from "@/lib/customers/matchSignals";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import type { Customer } from "@/types/customer";
import type { Order } from "@/types/order-history";
import type { Address } from "@/types/address-book";

import { requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  eshop_signup: "Eshop signup",
  admin_manual: "Από admin",
  phone: "Τηλεφωνική",
  in_store: "Σε κατάστημα",
};

export default async function AdminCustomerDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:orders");
  const params = await props.params;
  const admin = createAdminClient();

  const [{ data: custRow }, { data: orderRows }, { data: addressRows }] =
    await Promise.all([
      admin.from("customers").select("*").eq("id", params.id).maybeSingle(),
      admin
        .from("orders")
        .select("*")
        .eq("customer_id", params.id)
        .order("created_at", { ascending: false }),
      admin
        .from("addresses")
        .select("*")
        .eq("customer_id", params.id)
        .order("created_at", { ascending: false }),
    ]);

  if (!custRow) notFound();
  const customer = custRow as Customer;
  const orders = (orderRows ?? []) as Order[];
  const addresses = (addressRows ?? []) as Address[];

  // ─── Duplicate-suggestions query ───────────────────────────────────
  // Run the weighted matcher against this customer's contact fields.
  // The result includes the current customer itself (self-match scores
  // 100); we filter it out. For each remaining candidate we also fetch
  // a fresh order count so the admin sees "5 παραγγελίες" rather than
  // having to drill into each one.
  const matches = await findCustomerMatches(admin, {
    email: customer.email,
    phone: customer.phone,
    first_name: customer.first_name,
    last_name: customer.last_name,
  });
  const candidateMatches = matches.filter((m) => m.customer.id !== customer.id);
  let duplicateSuggestions: DuplicateSuggestion[] = [];
  if (candidateMatches.length > 0) {
    const candidateIds = candidateMatches.map((m) => m.customer.id);
    // customer_summary view carries the pre-aggregated
    // order_count, so we get N counts in one query without scanning
    // and reducing orders rows in JS.
    const { data: summaryRows } = await admin
      .from("customer_summary")
      .select("id, order_count")
      .in("id", candidateIds);
    const countByCustomer = new Map<string, number>();
    for (const r of (summaryRows ?? []) as Array<{ id: string; order_count: number }>) {
      countByCustomer.set(r.id, r.order_count);
    }
    duplicateSuggestions = candidateMatches.map((m) => ({
      customer: m.customer,
      score: m.score,
      confidence: m.confidence,
      reasons: m.reasons,
      order_count: countByCustomer.get(m.customer.id) ?? 0,
    }));
  }

  const displayName =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() ||
    customer.email ||
    "(χωρίς όνομα)";

  return (
    <>
      <Link href="/admin/customers" className="btn btn-secondary btn-sm mb-4">
        ← Πίσω στους πελάτες
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{displayName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {customer.email ?? "—"}
          {customer.phone && ` · ${customer.phone}`} ·{" "}
          {SOURCE_LABELS[customer.source] ?? customer.source}
          {customer.auth_user_id ? (
            <span className="ml-2 rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-xs">
              με λογαριασμό
            </span>
          ) : (
            <span className="ml-2 rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-xs">
              offline
            </span>
          )}
        </p>
      </header>

      {/* Duplicate suggestions — surfaced ABOVE the rest of the page
          so admins see merge candidates before they sink into the
          customer's edit/orders flow. Rendered conditionally (the
          component itself returns null when there are zero
          suggestions). */}
      {duplicateSuggestions.length > 0 && (
        <div className="mb-6">
          <CustomerDuplicatesSection
            currentCustomer={customer}
            suggestions={duplicateSuggestions}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info — editable */}
        <section className="lg:col-span-2 border rounded p-4 space-y-3">
          <h2 className="text-lg font-semibold">Στοιχεία</h2>
          <CustomerEditForm customer={customer} orderCount={orders.length} />
        </section>

        {/* Metadata */}
        <section className="border rounded p-4 space-y-2 text-sm">
          <h2 className="text-lg font-semibold mb-2">Σύνοψη</h2>
          <p>
            <span className="text-muted-foreground">Παραγγελίες:</span>{" "}
            <strong>{orders.length}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Σύνολο αξίας:</span>{" "}
            <strong>
              {formatCurrency(
                orders.reduce((s, o) => s + Number(o.total ?? 0), 0),
                customer.preferred_currency
              )}
            </strong>
          </p>
          <p>
            <span className="text-muted-foreground">Δημιουργήθηκε:</span>{" "}
            {new Date(customer.created_at).toLocaleDateString("el-GR")}
          </p>
          <p>
            <span className="text-muted-foreground">Ενημερώθηκε:</span>{" "}
            {new Date(customer.updated_at).toLocaleDateString("el-GR")}
          </p>
          <div className="pt-2">
            <Link
              href={`/admin/orders/new?customer_id=${customer.id}`}
              className="rounded border border-primary text-primary px-3 py-1 text-xs inline-block"
            >
              + Νέα παραγγελία για αυτόν τον πελάτη
            </Link>
          </div>
        </section>

        {/* Orders */}
        <section className="lg:col-span-3 border rounded p-4">
          <h2 className="text-lg font-semibold mb-3">Παραγγελίες</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Καμία παραγγελία ακόμη.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-3">Order #</th>
                  <th className="py-2 px-3">Ημ/νία</th>
                  <th className="py-2 px-3">Πληρωμή</th>
                  <th className="py-2 px-3">Παράδοση</th>
                  <th className="py-2 px-3">Πληρωμή</th>
                  <th className="py-2 px-3">Ροή</th>
                  <th className="py-2 px-3 text-center">Σύνολο</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody className="content-reveal">
                {orders.map((o) => (
                  <tr key={o.id} className="border-b hover:bg-muted/20">
                    <td className="py-2 px-3 font-mono">{o.order_number}</td>
                    <td className="py-2 px-3">
                      {new Date(o.created_at).toLocaleDateString("el-GR")}
                    </td>
                    <td className="py-2 px-3 text-xs">{o.payment_method}</td>
                    <td className="py-2 px-3 text-xs">{o.delivery_method}</td>
                    <td className="py-2 px-3 text-xs">{o.payment_status}</td>
                    <td className="py-2 px-3 text-xs">{o.fulfillment_status}</td>
                    <td className="py-2 px-3 text-center">
                      {formatCurrency(Number(o.total), o.currency)}
                    </td>
                    <td className="py-2 px-3">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="text-primary underline"
                      >
                        →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Addresses */}
        <section className="lg:col-span-3 border rounded p-4">
          <h2 className="text-lg font-semibold mb-3">Διευθύνσεις</h2>
          {addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Καμία αποθηκευμένη διεύθυνση.
            </p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {addresses.map((a) => (
                <li key={a.id} className="border rounded p-3">
                  <p className="font-medium">
                    {a.label ?? `${a.first_name} ${a.last_name}`}
                    {(a.is_default_shipping || a.is_default_billing) && (
                      <span className="ml-2 text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {[
                          a.is_default_shipping && "default ship",
                          a.is_default_billing && "default bill",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {a.address_line1}
                    {a.address_line2 ? `, ${a.address_line2}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {a.postal_code} {a.city}
                    {a.state ? `, ${a.state}` : ""} · {a.country_code}
                  </p>
                  {a.phone && (
                    <p className="text-muted-foreground text-xs mt-1">{a.phone}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
