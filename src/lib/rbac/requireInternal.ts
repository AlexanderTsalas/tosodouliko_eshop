import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isInternalUser } from "./isInternalUser";

/**
 * Coarse back-office gate. Use as the outermost guard on the /admin segment.
 *
 * - No session → /auth/signin (they need to authenticate).
 * - Signed in but a storefront customer → redirect to the storefront (`/`),
 *   NOT /auth/signin: they ARE signed in, they just aren't back-office staff.
 *
 * This sits in front of the granular `requirePermission(...)` checks: it draws
 * the customer/internal line once, and the per-page permission checks decide
 * what an internal user can actually do.
 */
export async function requireInternal(redirectTo = "/"): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/signin");
  }

  if (!(await isInternalUser())) {
    redirect(redirectTo);
  }
}
