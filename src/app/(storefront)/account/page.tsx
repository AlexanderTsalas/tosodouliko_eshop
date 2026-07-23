import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, Heart, MapPin, MonitorSmartphone, ChevronRight, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/actions/auth/signOut";
import PageHeader from "@/components/layout/PageHeader";

export const metadata = { title: "Λογαριασμός" };
// Reads auth state via createClient() → cookies(); this would auto-opt
// the route into dynamic anyway, but declaring it explicitly stops a
// future refactor of the auth pattern from silently re-staticing the
// page and serving one user's data to another.
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin?next=/account");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  const fullName = `${(profile as any)?.first_name ?? ""} ${(profile as any)?.last_name ?? ""}`.trim();
  const email = (profile as any)?.email ?? authData.user.email;

  const rows = [
    { href: "/orders", label: "Οι παραγγελίες μου", icon: Package },
    { href: "/wishlist", label: "Λίστα επιθυμιών", icon: Heart },
    { href: "/account/addresses", label: "Διευθύνσεις", icon: MapPin },
    { href: "/account/sessions", label: "Ενεργές συνεδρίες", icon: MonitorSmartphone },
  ];

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader
        title="Λογαριασμός"
        description={[fullName, email].filter(Boolean).join(" · ")}
      />

      <nav className="rounded-sm border border-stone-taupe/20 bg-card divide-y divide-stone-taupe/15 overflow-hidden">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <Link
              key={row.href}
              href={row.href}
              className="group flex items-center gap-3 px-4 py-3.5 hover:bg-warm-sand/30 transition-colors"
            >
              <Icon className="w-5 h-5 text-terracotta shrink-0" />
              <span className="flex-1 text-ink font-medium">{row.label}</span>
              <ChevronRight className="w-4 h-4 text-stone-taupe group-hover:text-terracotta group-hover:translate-x-0.5 transition-all" />
            </Link>
          );
        })}
      </nav>

      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="inline-flex items-center gap-2 border border-stone-taupe/30 rounded-sm px-4 py-2 text-sm text-ink hover:border-terracotta hover:text-terracotta transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Αποσύνδεση
        </button>
      </form>
    </main>
  );
}
