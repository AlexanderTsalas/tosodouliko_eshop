import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWishlistWithProducts } from "@/lib/wishlist";
import WishlistItemRow from "@/components/features/wishlist/WishlistItemRow";
import WishlistRealtimeBanner from "@/components/features/wishlist/WishlistRealtimeBanner";
import PageHeader from "@/components/layout/PageHeader";
import { strings } from "@/config/strings";

export const metadata = { title: strings.wishlist.pageTitle };
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin?next=/wishlist");

  // Customer id is needed for the Realtime channel subscription. Customers
  // are auto-created via the user_profiles → customers trigger chain, so a
  // missing row here means a brand-new account whose trigger hasn't fired
  // yet — render without the banner in that case.
  const { data: custRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;

  const result = await getWishlistWithProducts();
  const wishlist = result.success ? result.data : null;
  const items = wishlist?.items ?? [];

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader
        title={strings.wishlist.pageTitle}
        description={strings.wishlist.pageDescription}
        breadcrumb={[{ label: "Αρχική", href: "/" }, { label: strings.wishlist.pageTitle }]}
      />

      {customerId && <WishlistRealtimeBanner customerId={customerId} />}

      {items.length === 0 ? (
        <div className="rounded-sm border border-dashed border-stone-taupe/40 bg-warm-sand/20 p-8 text-center">
          <p className="text-stone-taupe mb-3">
            {strings.wishlist.empty}
          </p>
          <Link href="/products" className="text-terracotta hover:underline font-medium">
            {strings.wishlist.browseProducts}
          </Link>
        </div>
      ) : (
        <ul className="divide-y border-t border-b">
          {items.map((item) => (
            <WishlistItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
