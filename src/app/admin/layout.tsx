import { headers } from "next/headers";
import { requireInternal, requireMFA } from "@/lib/rbac";
import AdminBottomDock from "@/components/features/backoffice-shell/AdminBottomDock";
import PageTransitionWrapper from "@/components/layout/PageTransitionWrapper";

/**
 * Admin segment layout — the persistent shell that wraps every admin
 * route. The bottom dock is rendered HERE so it stays mounted across
 * navigations between admin routes; pages only render their content
 * area. The dock is fixed-positioned and overlays the bottom of the
 * viewport (Apple-Dock style), so the main content gets bottom padding
 * to keep its last row above the dock.
 *
 * Per-page permission checks live in each page handler (e.g.,
 * `await requirePermission("manage:orders")` at the top of the orders
 * page). Doing it here would force a single base permission for the
 * whole admin, which doesn't match the granular RBAC model.
 *
 * MFA enforcement DOES live here (one check, all admin routes covered)
 * — except for the MFA enroll/verify pages themselves, which sit
 * inside `/admin/` for URL hygiene but can't be wrapped by the MFA
 * gate without creating a redirect loop (the gate would redirect them
 * to themselves). We detect those via the `x-pathname` header set by
 * middleware and render a bare shell instead.
 */
export default async function AdminSegmentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isMfaPage =
    pathname === "/admin/mfa-enroll" || pathname === "/admin/mfa-verify";

  if (isMfaPage) {
    return <>{children}</>;
  }

  // Coarse boundary: only internal (back-office) users may reach /admin.
  // A signed-in storefront customer is bounced to the storefront; this runs
  // before MFA and before the per-page requirePermission() checks.
  await requireInternal();
  await requireMFA();

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 min-w-0 px-6 lg:px-10 2xl:px-16 py-6 pb-32">
        {/* PageTransitionWrapper keys the children by pathname so
            each navigation remounts the inner div and fires the
            .page-enter animation. The dock (outside this wrapper)
            stays mounted across navigations. */}
        <PageTransitionWrapper>{children}</PageTransitionWrapper>
      </main>
      <AdminBottomDock />
    </div>
  );
}
