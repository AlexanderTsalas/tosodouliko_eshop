import { createClient } from "@/lib/supabase/server";
import MediaBrowser from "@/components/admin/media/MediaBrowser";
import type { MediaAsset } from "@/types/media-library";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Αρχεία — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminMediaPage(
  props: {
    searchParams: Promise<{ folder?: string; type?: string }>;
  }
) {
  await requirePermission("manage:media");
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("media_assets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (searchParams.folder) query = query.eq("folder", searchParams.folder);
  if (searchParams.type === "image") query = query.like("mime_type", "image/%");

  const { data } = await query;

  // Distinct folders for filter dropdown.
  const { data: folderRows } = await supabase
    .from("media_assets")
    .select("folder")
    .not("folder", "is", null);
  const folders = Array.from(
    new Set(((folderRows ?? []) as { folder: string | null }[])
      .map((r) => r.folder)
      .filter((f): f is string => Boolean(f)))
  );

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Αρχεία ({(data ?? []).length})</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <select name="folder" defaultValue={searchParams.folder ?? ""} className="border rounded px-3 py-1">
          <option value="">Όλοι οι φάκελοι</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select name="type" defaultValue={searchParams.type ?? ""} className="border rounded px-3 py-1">
          <option value="">Όλοι οι τύποι</option>
          <option value="image">Εικόνες μόνο</option>
        </select>
        <button type="submit" className="rounded border px-3 py-1">Φιλτράρισμα</button>
      </form>

      <MediaBrowser initial={(data ?? []) as MediaAsset[]} />
    </>
  );
}
