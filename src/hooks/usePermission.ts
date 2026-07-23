"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface UsePermissionState {
  data: boolean | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Client-side permission check. Calls the `has_permission(text)` RPC via the
 * browser client (which uses the user's auth session).
 *
 * Note: this is a UX hint only — server actions / RSC must re-check
 * permissions before performing privileged operations. Never trust the
 * client-side answer alone.
 */
export function usePermission(permissionName: string): UsePermissionState {
  const [state, setState] = useState<UsePermissionState>({
    data: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("has_permission", {
        perm: permissionName,
      });
      if (cancelled) return;
      if (error) {
        setState({ data: false, isLoading: false, error: error.message });
        return;
      }
      setState({ data: Boolean(data), isLoading: false, error: null });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [permissionName]);

  return state;
}
