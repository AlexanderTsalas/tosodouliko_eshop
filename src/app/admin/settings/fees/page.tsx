import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import FeeCategoriesEditor from "@/components/admin/fees/FeeCategoriesEditor";
import type { FeeCategory, FeeRule } from "@/types/fee";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Χρεώσεις & κόμιστρα — Admin" };
export const dynamic = "force-dynamic";

/**
 * Fees settings page. Lists fee categories (shipping + cod_handling are seeded
 * as system rows; the merchant can add their own e.g. "service fee",
 * "gift-wrap charge"). Each category has rules under it that decide the actual
 * amount per order. The resolver in src/lib/fees/resolve.ts evaluates these at
 * order creation time.
 */
export default async function FeesSettingsPage() {
  await requirePermission("manage:fees");
  const admin = createAdminClient();

  const [catsRes, rulesRes] = await Promise.all([
    admin.from("fee_categories").select("*").order("display_order", { ascending: true }),
    admin.from("fee_rules").select("*").order("priority", { ascending: true }),
  ]);

  const categories = (catsRes.data ?? []) as FeeCategory[];
  const rules = (rulesRes.data ?? []) as FeeRule[];
  const loadError = catsRes.error?.message ?? rulesRes.error?.message ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Ρυθμίσεις"
        title="Χρεώσεις & κόμιστρα"
        description={
          <>
            Ορίστε κατηγορίες χρεώσεων (μεταφορικά, αντικαταβολή, και όποιες δικές
            σας χρειάζεστε) και κανόνες που καθορίζουν πόσο χρεώνεται κάθε
            παραγγελία. Σε σύγκρουση κανόνων κερδίζει το πιο συγκεκριμένο
            scope: variant &gt; product &gt; category &gt; global.
          </>
        }
      />

      {loadError && (
        <div className="cms-card border-destructive bg-destructive/5 text-sm text-destructive mb-4">
          Σφάλμα φόρτωσης: {loadError}
        </div>
      )}

      <FeeCategoriesEditor categories={categories} rules={rules} />
    </>
  );
}
