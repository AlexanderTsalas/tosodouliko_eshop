import { requireMFA, requirePermission } from "@/lib/rbac";
import AdminSidebar from "./AdminSidebar";

/**
 * Admin shell layout. Runs two server-side gates before rendering:
 *
 *   1. requirePermission — verifies the user holds the named admin
 *      permission. Redirects to /auth/signin if not.
 *   2. requireMFA — verifies the session is at AAL2 (a second factor has been
 *      verified). Redirects to /admin/mfa-enroll (if no factors registered)
 *      or /admin/mfa-verify (if factors registered but session is AAL1).
 *
 * Together these mean: every page wrapped by AdminLayout requires both the
 * RBAC permission AND a fresh MFA-verified session. The MFA enrollment and
 * verification pages themselves deliberately do NOT use AdminLayout (they
 * have their own minimal shell), otherwise the redirect would loop.
 *
 * Compose this in any admin page, e.g.:
 *
 *   export default async function Page() {
 *     return <AdminLayout><MyAdminContent /></AdminLayout>;
 *   }
 */
export default async function AdminLayout({
  children,
  permission = "manage:products",
}: {
  children: React.ReactNode;
  permission?: string;
}) {
  await requirePermission(permission);
  await requireMFA();

  return (
    // Full viewport-width admin shell. Sidebar gets its own column that
    // bleeds to the LEFT viewport edge (no outer padding on the left of
    // the sidebar) and carries a distinct background, so the CMS chrome
    // reads as a separate panel — like an IDE / chat-app sidebar — not
    // as in-content navigation.
    //
    // Main content keeps responsive side padding so dense tables breathe
    // but stop short of the right edge on wide monitors.
    <div className="flex min-h-screen">
      {/* Sticky sidebar — viewport-locked, scrolls its own contents
          independently when they overflow. Without this the sidebar
          scrolled away with long admin pages (offers workspace etc.) */}
      <aside className="cms-sidebar-column w-[280px] shrink-0 border-r border-foreground/10 py-6 sticky top-0 h-screen overflow-y-auto">
        <AdminSidebar />
      </aside>
      <main className="flex-1 min-w-0 px-6 lg:px-10 2xl:px-16 py-6">
        {children}
      </main>
    </div>
  );
}
