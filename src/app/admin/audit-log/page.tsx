import { createAdminClient } from "@/lib/supabase/admin";
import type { AuditEvent } from "@/types/audit-log";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Audit log — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminAuditLogPage(
  props: {
    searchParams: Promise<{ resource?: string; action?: string; page?: string }>;
  }
) {
  await requirePermission("read:audit-log");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("audit_events")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (searchParams.resource) query = query.eq("resource_type", searchParams.resource);
  if (searchParams.action) query = query.ilike("action", `%${searchParams.action}%`);

  const { data, count } = await query;
  const rows = (data ?? []) as AuditEvent[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Audit log ({total})</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <input
          name="resource"
          defaultValue={searchParams.resource ?? ""}
          placeholder="resource type (π.χ. product, order)"
          className="border rounded px-3 py-1 flex-1"
        />
        <input
          name="action"
          defaultValue={searchParams.action ?? ""}
          placeholder="action (π.χ. product.created)"
          className="border rounded px-3 py-1 flex-1"
        />
        <button type="submit" className="rounded border px-3 py-1">Φιλτράρισμα</button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Κανένα audit event.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Time</th>
              <th className="py-2">Actor</th>
              <th className="py-2">Action</th>
              <th className="py-2">Resource</th>
              <th className="py-2">Metadata</th>
            </tr>
          </thead>
          <tbody className="content-reveal">
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString("el-GR")}
                </td>
                <td className="py-2 font-mono">{r.actor_id?.slice(0, 8) ?? "—"} ({r.actor_type})</td>
                <td className="py-2 font-mono">{r.action}</td>
                <td className="py-2 font-mono">{r.resource_type}/{r.resource_id ?? "—"}</td>
                <td className="py-2">
                  <pre className="text-xs bg-muted/40 rounded p-1 overflow-auto max-w-md">
                    {JSON.stringify(r.metadata, null, 1)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex justify-between text-sm">
          {page > 1 ? (
            <a href={`?resource=${searchParams.resource ?? ""}&action=${searchParams.action ?? ""}&page=${page - 1}`} className="underline">
              ← Προηγούμενη
            </a>
          ) : <span />}
          <span className="text-muted-foreground">Σελίδα {page} / {totalPages}</span>
          {page < totalPages ? (
            <a href={`?resource=${searchParams.resource ?? ""}&action=${searchParams.action ?? ""}&page=${page + 1}`} className="underline">
              Επόμενη →
            </a>
          ) : <span />}
        </nav>
      )}
    </>
  );
}
