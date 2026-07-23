import { createClient } from "@/lib/supabase/server";
import CurrenciesEditor from "@/components/admin/currencies/CurrenciesEditor";
import type { Currency } from "@/types/multi-currency";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νομίσματα — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminCurrenciesPage() {
  await requirePermission("manage:currencies");
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("*")
    .order("code");

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Νομίσματα</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Ενεργοποιήστε ή απενεργοποιήστε νομίσματα και ορίστε τις ισοτιμίες σε σχέση με το βασικό. Νομίσματα που χρησιμοποιούνται ήδη από προϊόντα ή παραγγελίες δεν διαγράφονται.
      </p>
      <CurrenciesEditor initial={(data ?? []) as Currency[]} />
    </>
  );
}
