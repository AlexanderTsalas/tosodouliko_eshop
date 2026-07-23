"use client";

import { useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Phase 9: lazy anonymous-session bootstrap.
 *
 * Returns a function callers invoke before any server action that requires
 * `auth.uid()`. If the visitor already has a session (anonymous or
 * permanent), it returns the user id without a network call. Otherwise it
 * runs `supabase.auth.signInAnonymously()`, which creates an `auth.users`
 * row with `is_anonymous=true` and writes the session cookie. The
 * subsequent server action then sees `auth.uid()` and works normally —
 * cart adds, contention modals, soft-wait queue joins, checkout, etc.
 *
 * Wishlist subscriptions still require a permanent account; that path
 * upgrades the anon user via `auth.updateUser({ email })` later.
 *
 * Deduplicates concurrent calls so a fast double-click doesn't create two
 * anonymous users.
 */
export function useEnsureSession() {
  const inFlightRef = useRef<Promise<string | null> | null>(null);

  return useCallback(async (): Promise<string | null> => {
    if (inFlightRef.current) return inFlightRef.current;
    const supabase = createClient();
    const promise = (async () => {
      const { data: existing } = await supabase.auth.getUser();
      if (existing.user) return existing.user.id;
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) {
        console.error(
          `[useEnsureSession] signInAnonymously failed: ${error?.message}`
        );
        return null;
      }
      return data.user.id;
    })();
    inFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      inFlightRef.current = null;
    }
  }, []);
}
