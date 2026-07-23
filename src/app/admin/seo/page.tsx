import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { Pencil } from "@/components/admin/common/icons";
import type { SeoMetadata } from "@/types/dynamic-seo";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "SEO — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSeoPage() {
  await requirePermission("manage:seo");
  const supabase = await createClient();
  const { data } = await supabase
    .from("seo_metadata")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as SeoMetadata[];

  return (
    <>
      <PageHeader
        title="SEO metadata"
        description="Εξατομικευμένο meta-content ανά resource (προϊόν, κατηγορία, σελίδα)."
        actions={
          <Link href="/admin/seo/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέο record
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="cms-empty">
          Δεν υπάρχει αποθηκευμένο SEO metadata. Δημιουργήστε ένα record για
          κάθε σελίδα ή προϊόν που θέλετε να εξατομικεύσετε.
        </div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Title</th>
                <th>No-index</th>
                <th>Updated</th>
                <th>Ενέργειες</th>
              </tr>
            </thead>
            <tbody className="content-reveal">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">
                    {r.resource_type}/{r.resource_id}
                  </td>
                  <td className="truncate max-w-xs">{r.title ?? "—"}</td>
                  <td>
                    {r.no_index ? (
                      <span className="cms-badge border-foreground/40 bg-background font-semibold">
                        no-index
                      </span>
                    ) : (
                      <span className="cms-badge cms-badge-muted">—</span>
                    )}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(r.updated_at).toLocaleDateString("el-GR")}
                  </td>
                  <td className="text-center">
                    <Link
                      href={`/admin/seo/edit?type=${encodeURIComponent(r.resource_type)}&id=${encodeURIComponent(r.resource_id)}`}
                      className="btn btn-secondary btn-sm"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Επεξεργασία
                    </Link>
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
