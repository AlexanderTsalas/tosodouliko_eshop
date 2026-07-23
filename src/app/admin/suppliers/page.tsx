import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import type { Supplier } from "@/types/suppliers";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Προμηθευτές — Admin" };
export const dynamic = "force-dynamic";

export default async function SuppliersListPage() {
  await requirePermission("manage:suppliers");
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .order("name");

  const suppliers = (data ?? []) as Supplier[];

  return (
    <>
      <PageHeader
        title="Προμηθευτές"
        description={`${suppliers.length.toLocaleString("el-GR")} συνολικά. Διαχείριση στοιχείων επικοινωνίας, νομίσματος και ανάθεσης σε προϊόντα.`}
        actions={
          <Link href="/admin/suppliers/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέος προμηθευτής
          </Link>
        }
      />

      {suppliers.length === 0 ? (
        <div className="cms-empty">
          Δεν έχουν οριστεί προμηθευτές. Προσθέστε τον πρώτο για να ξεκινήσετε.
        </div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>Email</th>
                <th>Τηλέφωνο</th>
                <th>Νόμισμα</th>
                <th>Χώρα</th>
                <th>Κατάσταση</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {suppliers.map((s) => (
                <tr key={s.id} className={!s.active ? "opacity-60" : undefined}>
                  <td className="font-medium">
                    <Link
                      href={`/admin/suppliers/${s.id}`}
                      className="hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground">
                    {s.primary_email ? (
                      <a
                        href={`mailto:${s.primary_email}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {s.primary_email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-muted-foreground font-mono text-xs">
                    {s.primary_phone ? (
                      <a
                        href={`tel:${s.primary_phone}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {s.primary_phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="font-mono text-xs">{s.default_currency}</td>
                  <td className="font-mono text-xs">{s.country_code ?? "—"}</td>
                  <td>
                    {s.active ? (
                      <span className="cms-badge cms-badge-neutral">
                        <span className="cms-badge-dot" aria-hidden />
                        Ενεργός
                      </span>
                    ) : (
                      <span className="cms-badge cms-badge-muted">
                        Ανενεργός
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
