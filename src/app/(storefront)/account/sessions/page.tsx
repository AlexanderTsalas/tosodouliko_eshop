import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ActiveSessions from "@/components/features/session-management/ActiveSessions";
import PageHeader from "@/components/layout/PageHeader";
import type { UserSession } from "@/types/session-management";

export const metadata = { title: "Ενεργές συνεδρίες" };
export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin?next=/account/sessions");

  const { data } = await supabase
    .from("user_sessions")
    .select("*")
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .order("last_active_at", { ascending: false });

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader
        title="Ενεργές συνεδρίες"
        breadcrumb={[{ label: "Αρχική", href: "/" }, { label: "Λογαριασμός", href: "/account" }, { label: "Συνεδρίες" }]}
      />
      <ActiveSessions sessions={(data ?? []) as UserSession[]} />
    </main>
  );
}
