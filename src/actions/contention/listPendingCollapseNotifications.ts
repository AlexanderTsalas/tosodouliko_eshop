"use server";

import { createClient } from "@/lib/supabase/server";
import { ok, type Result } from "@/types/result";

export interface PendingCollapseNotification {
  id: string;
  variant_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  variant_label: string | null;
}

/**
 * Backfill source for CollapseWatcher. The Realtime INSERT subscription
 * only catches rows inserted while the client is connected; if the
 * customer was offline when the holder paid, the notification still
 * exists in their inbox. On mount, the watcher calls this to surface
 * any unacknowledged rows.
 */
export async function listPendingCollapseNotifications(): Promise<
  Result<PendingCollapseNotification[]>
> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok([]);

  // RLS scopes select to the caller's own customer rows; no admin client
  // needed.
  const { data, error } = await supabase
    .from("collapse_notifications")
    .select("id, variant_id, product_id, product_name, product_slug, variant_label")
    .is("acknowledged_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    return ok([]);
  }
  return ok((data ?? []) as PendingCollapseNotification[]);
}
