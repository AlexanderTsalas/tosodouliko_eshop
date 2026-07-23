import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrderHistory from "@/components/features/orders/OrderHistory";
import PageHeader from "@/components/layout/PageHeader";

export const metadata = { title: "Οι παραγγελίες μου" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin?next=/orders");

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader
        title="Οι παραγγελίες μου"
        breadcrumb={[{ label: "Αρχική", href: "/" }, { label: "Λογαριασμός", href: "/account" }, { label: "Παραγγελίες" }]}
      />
      <OrderHistory />
    </main>
  );
}
