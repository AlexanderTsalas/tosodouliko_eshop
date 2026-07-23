"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Returns whether the current visitor is signed in via an anonymous
 * Supabase auth session. Used to gate wishlist actions and the
 * "Save your info" prompt — both require a real email before they can
 * deliver value.
 *
 * Returns:
 *   - undefined while the initial getUser() is in flight
 *   - true  if signed in via signInAnonymously() (no email on auth user)
 *   - false if signed in via a permanent account, or signed out entirely
 *
 * Updates live via the auth state change subscription so the value flips
 * the moment a magic-link confirmation or merge completes elsewhere.
 */
export function useIsAnonymous(): boolean | undefined {
  const [isAnon, setIsAnon] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    let canceled = false;

    void supabase.auth.getUser().then(({ data }) => {
      if (!canceled) setIsAnon(Boolean(data.user?.is_anonymous));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAnon(Boolean(session?.user?.is_anonymous));
    });

    return () => {
      canceled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return isAnon;
}
