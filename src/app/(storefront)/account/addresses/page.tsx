import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AddressForm from "@/components/features/address-book/AddressForm";
import AddressCard from "@/components/features/address-book/AddressCard";
import PageHeader from "@/components/layout/PageHeader";
import type { Address } from "@/types/address-book";

export const metadata = { title: "Διευθύνσεις" };

// Always fetch fresh. Otherwise Next.js's Router Cache can persist a
// pre-save snapshot of the addresses list for up to 30s after a server
// action inserts a new row.
export const dynamic = "force-dynamic";

export default async function AddressesPage(
  props: {
    searchParams: Promise<{ edit?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin?next=/account/addresses");

  // Resolve customer_id (1:1 with auth user). The sync_customer_from_profile
  // trigger creates the row on signup; users may briefly have none if the
  // trigger hasn't run yet, in which case we show an empty state.
  const { data: customerRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (customerRow as { id: string } | null)?.id ?? null;

  const { data } = customerId
    ? await supabase
        .from("addresses")
        .select("*")
        .eq("customer_id", customerId)
        .order("is_default_shipping", { ascending: false })
        .order("created_at", { ascending: false })
    : { data: null };

  const addresses = (data ?? []) as Address[];

  const editing = searchParams.edit
    ? addresses.find((a) => a.id === searchParams.edit) ?? null
    : null;

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader
        title="Διευθύνσεις"
        breadcrumb={[{ label: "Αρχική", href: "/" }, { label: "Λογαριασμός", href: "/account" }, { label: "Διευθύνσεις" }]}
      />

      <section className="mb-8">
        <h2 className="text-lg font-medium mb-3">
          Αποθηκευμένες ({addresses.length})
        </h2>
        {addresses.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Δεν έχετε αποθηκευμένες διευθύνσεις. Προσθέστε μία παρακάτω.
          </p>
        ) : (
          <ul className="space-y-2">
            {addresses.map((a) => (
              <AddressCard key={a.id} address={a} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <header className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-medium">
            {editing ? "Επεξεργασία διεύθυνσης" : "Προσθήκη νέας διεύθυνσης"}
          </h2>
          {editing && (
            <Link
              href="/account/addresses"
              className="text-xs text-terracotta hover:underline"
              scroll={false}
            >
              ← Πίσω σε νέα
            </Link>
          )}
        </header>
        <AddressForm
          key={editing?.id ?? "new"}
          initial={editing ?? undefined}
        />
      </section>
    </main>
  );
}
