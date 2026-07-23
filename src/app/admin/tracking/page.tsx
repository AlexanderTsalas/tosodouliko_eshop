import { createAdminClient } from "@/lib/supabase/admin";
import type { TrackingEvent } from "@/types/user-tracking";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Tracking — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminTrackingPage(
  props: {
    searchParams: Promise<{ event?: string; page?: string }>;
  }
) {
  await requirePermission("read:tracking");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("tracking_events")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (searchParams.event) query = query.eq("event_name", searchParams.event);

  const { data, count } = await query;
  const rows = (data ?? []) as TrackingEvent[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Tracking events ({total})</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <input
          name="event"
          defaultValue={searchParams.event ?? ""}
          placeholder="event_name (π.χ. page_view, add_to_cart)"
          className="border rounded px-3 py-1 flex-1"
        />
        <button type="submit" className="rounded border px-3 py-1">Φιλτράρισμα</button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Κανένα event.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Time</th>
              <th className="py-2">Session</th>
              <th className="py-2">User</th>
              <th className="py-2">Event</th>
              <th className="py-2">URL</th>
              <th className="py-2">Properties</th>
            </tr>
          </thead>
          <tbody className="content-reveal">
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString("el-GR")}
                </td>
                <td className="py-2 font-mono">{r.session_id.slice(0, 8)}</td>
                <td className="py-2 font-mono">{r.user_id?.slice(0, 8) ?? "—"}</td>
                <td className="py-2 font-mono">{r.event_name}</td>
                <td className="py-2 truncate max-w-xs">{r.url ?? "—"}</td>
                <td className="py-2">
                  <pre className="text-xs bg-muted/40 rounded p-1 overflow-auto max-w-xs">
                    {JSON.stringify(r.properties, null, 1)}
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
            <a href={`?event=${searchParams.event ?? ""}&page=${page - 1}`} className="underline">← Προηγούμενη</a>
          ) : <span />}
          <span className="text-muted-foreground">Σελίδα {page} / {totalPages}</span>
          {page < totalPages ? (
            <a href={`?event=${searchParams.event ?? ""}&page=${page + 1}`} className="underline">Επόμενη →</a>
          ) : <span />}
        </nav>
      )}
    </>
  );
}
