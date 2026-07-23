import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import VatRatesManager from "@/components/admin/vat-rates/VatRatesManager";
import type { VatRate } from "@/types/vat-rates";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Κατηγορίες ΦΠΑ — Admin" };
export const dynamic = "force-dynamic";

export default async function VatRatesPage() {
  await requirePermission("manage:vat_rates");
  const supabase = await createClient();
  const { data } = await supabase
    .from("vat_rates")
    .select("*")
    .order("rate");

  return (
    <>
      <PageHeader
        eyebrow="Ρυθμίσεις"
        title="Κατηγορίες ΦΠΑ"
        description="Ορίστε τις κατηγορίες ΦΠΑ που ισχύουν στο κατάστημα. Κάθε κατηγορία προϊόντων αναθέτει μία ως προεπιλογή, με δυνατότητα παράκαμψης ανά προϊόν. Μία κατηγορία πρέπει πάντα να είναι σημειωμένη ως προεπιλεγμένη."
      />
      <VatRatesManager initial={(data ?? []) as VatRate[]} />
    </>
  );
}
