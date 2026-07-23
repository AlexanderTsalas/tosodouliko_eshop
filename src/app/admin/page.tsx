import Link from "next/link";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission, requirePermission } from "@/lib/rbac";

export const metadata = { title: "Πίνακας ελέγχου — Admin" };
export const dynamic = "force-dynamic";

interface QuickStat {
  label: string;
  value: string | number;
  href: string;
  /** Optional short status/context line below the count. */
  hint?: string;
}

interface ActionCard {
  title: string;
  description: string;
  href: string;
  cta: string;
  /** Permission gate — card hidden if the user lacks it. */
  permission: string;
}

const ACTIONS: ActionCard[] = [
  {
    title: "Νέο προϊόν",
    description:
      "Προσθήκη νέου προϊόντος στον καταλόγο με παραλλαγές και τιμές.",
    href: "/admin/products/new",
    cta: "Δημιουργία προϊόντος",
    permission: "manage:products",
  },
  {
    title: "Παραγγελίες ημέρας",
    description:
      "Δείτε τις τελευταίες παραγγελίες και διαχειριστείτε την εκκρεμή ροή αποστολών.",
    href: "/admin/orders",
    cta: "Άνοιγμα παραγγελιών",
    permission: "manage:orders",
  },
  {
    title: "Απόθεμα",
    description:
      "Ελέγξτε τα χαμηλά αποθέματα και ενημερώστε ποσότητες ανά παραλλαγή.",
    href: "/admin/inventory",
    cta: "Άνοιγμα αποθέματος",
    permission: "manage:products",
  },
  {
    title: "Πελάτες",
    description:
      "Αναζητήστε πελάτες, δείτε ιστορικό παραγγελιών και διευθύνσεις.",
    href: "/admin/customers",
    cta: "Άνοιγμα πελατών",
    permission: "manage:orders",
  },
  {
    title: "Επιστροφές",
    description:
      "Διαχειριστείτε αιτήματα επιστροφής και εγκρίσεις αποζημιώσεων.",
    href: "/admin/returns",
    cta: "Άνοιγμα επιστροφών",
    permission: "manage:returns",
  },
  {
    title: "Newsletter",
    description:
      "Στείλτε καμπάνια ή δείτε τους εγγεγραμμένους συνδρομητές.",
    href: "/admin/newsletter",
    cta: "Άνοιγμα newsletter",
    permission: "manage:newsletter",
  },
  {
    title: "Περιθώρια Κέρδους",
    description:
      "Δείτε το καθαρό περιθώριο ανά προϊόν, εντοπίστε προϊόντα με ζημία ή χαμηλό κέρδος.",
    href: "/admin/reports/margins",
    cta: "Άνοιγμα αναφοράς",
    permission: "manage:products",
  },
];

export default async function AdminDashboardPage() {
  // Dashboard is the hub — accessible to anyone with at least the base
  // catalog permission. Per-card gating via checkPermission below
  // hides cards the user can't act on.
  await requirePermission("manage:products");
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const userName =
    (authData.user?.user_metadata as { first_name?: string } | undefined)
      ?.first_name ?? authData.user?.email?.split("@")[0] ?? "Διαχειριστή";

  // Lightweight stat tiles. All queries are HEAD-only counts on indexed
  // columns so this page stays fast. Each tile is independently
  // permission-gated so a low-privilege admin doesn't see noise.
  const admin = createAdminClient();
  const [
    canOrders,
    canProducts,
    canCustomers,
    canReturns,
  ] = await Promise.all([
    checkPermission("manage:orders"),
    checkPermission("manage:products"),
    checkPermission("manage:orders"),
    checkPermission("manage:returns"),
  ]);

  // Run every gated count query in parallel. Each is a head-only
  // `count: 'exact'` so they're cheap individually; what matters is
  // not awaiting them sequentially. Five permission-gated counts
  // formerly took ~5x a single round-trip; now ~1x.
  const [
    pendingOrdersRes,
    totalProductsRes,
    lowStockRes,
    customersRes,
    pendingReturnsRes,
  ] = await Promise.all([
    canOrders
      ? admin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("fulfillment_status", [
            "pending",
            "confirmed",
            "preparing",
            "shipped",
            "out_for_delivery",
          ])
      : Promise.resolve({ count: null }),
    canProducts
      ? admin
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
      : Promise.resolve({ count: null }),
    canProducts
      ? admin
          .from("inventory_items")
          .select("variant_id", { count: "exact", head: true })
          .gt("quantity_available", 0)
          .lte("quantity_available", 5)
      : Promise.resolve({ count: null }),
    canCustomers
      ? admin
          .from("user_profiles")
          .select("id", { count: "exact", head: true })
      : Promise.resolve({ count: null }),
    canReturns
      ? admin
          .from("return_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
      : Promise.resolve({ count: null }),
  ]);

  const stats: QuickStat[] = [];

  if (canOrders) {
    stats.push({
      label: "Ενεργές παραγγελίες",
      value: pendingOrdersRes.count ?? 0,
      href: "/admin/orders",
      hint: "Σε εξέλιξη ή προς αποστολή",
    });
  }

  if (canProducts) {
    stats.push({
      label: "Ενεργά προϊόντα",
      value: totalProductsRes.count ?? 0,
      href: "/admin/products",
    });
    stats.push({
      label: "Χαμηλό απόθεμα",
      value: lowStockRes.count ?? 0,
      href: "/admin/inventory",
      hint: "Παραλλαγές με ≤ 5 διαθέσιμα",
    });
  }

  if (canCustomers) {
    stats.push({
      label: "Σύνολο πελατών",
      value: customersRes.count ?? 0,
      href: "/admin/customers",
    });
  }

  if (canReturns && (pendingReturnsRes.count ?? 0) > 0) {
    stats.push({
      label: "Επιστροφές προς έλεγχο",
      value: pendingReturnsRes.count ?? 0,
      href: "/admin/returns",
    });
  }

  // Filter action cards by permission so the dashboard never shows
  // a tile the admin can't actually use.
  const actionPermissions = await Promise.all(
    ACTIONS.map((a) => checkPermission(a.permission))
  );
  const visibleActions = ACTIONS.filter((_, i) => actionPermissions[i]);

  return (
    <>
      <PageHeader
        eyebrow="Αρχική"
        title={`Καλωσήρθες, ${userName}.`}
        description="Επισκόπηση τρέχουσας κατάστασης καταλόγου, παραγγελιών και ομάδας."
      />

      {stats.length > 0 && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="cms-card hover:border-foreground/40 transition-colors group"
            >
              <p className="text-xs text-muted-foreground font-medium group-hover:text-foreground transition-colors">
                {stat.label}
              </p>
              <p className="text-3xl font-semibold tracking-tight mt-2 tabular-nums">
                {stat.value}
              </p>
              {stat.hint && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {stat.hint}
                </p>
              )}
            </Link>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground mb-3">
          Συχνές ενέργειες
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleActions.map((action) => (
            <article key={action.href} className="cms-card flex flex-col">
              <h3 className="font-semibold tracking-tight">{action.title}</h3>
              <p className="text-sm text-muted-foreground mt-1.5 flex-1">
                {action.description}
              </p>
              <Link href={action.href} className="btn btn-secondary btn-sm mt-4 self-start">
                {action.cta} →
              </Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
