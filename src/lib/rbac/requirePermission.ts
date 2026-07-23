import { redirect } from "next/navigation";
import { checkPermission } from "./checkPermission";

/**
 * Server component / server action guard. Redirects to /auth/signin if the
 * current user lacks the named permission.
 *
 * Use in admin pages and server actions:
 *   await requirePermission("manage:products");
 */
export async function requirePermission(
  permissionName: string,
  redirectTo = "/auth/signin"
): Promise<void> {
  const allowed = await checkPermission(permissionName);
  if (!allowed) {
    redirect(redirectTo);
  }
}
