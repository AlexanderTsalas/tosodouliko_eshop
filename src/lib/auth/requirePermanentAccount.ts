"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side gate for actions that require a permanent (non-anonymous)
 * account. Spec §8.3: the wishlist is the canonical example — durable
 * interest requires identity.
 *
 * Returns true if the caller is already a permanent account holder and the
 * caller may proceed. Otherwise navigates to /auth/signup with a `next`
 * param pointing back to the current URL and returns false — the caller
 * should bail out of the action.
 *
 * Sign-up path: standard password + email-verification flow (the user gets
 * Supabase's account-confirmation email, clicks it, lands on
 * /auth/callback?code=...&next=<originating-url>, then is bounced back to
 * the originating page to retry the action with a real account.
 *
 * If you also want to support already-registered users coming through the
 * sign-in flow, point this at /auth/signin instead — it accepts the same
 * `next` param. Today we route through signup because the most common path
 * is brand-new visitors.
 */
export async function redirectToSignupIfNotPermanent(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user && !data.user.is_anonymous) return true;
  const next =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/";
  window.location.href = `/auth/signup?next=${encodeURIComponent(next)}`;
  return false;
}
