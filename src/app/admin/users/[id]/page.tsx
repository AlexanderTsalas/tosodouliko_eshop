import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import UserRolesPanel from "@/components/admin/rbac/UserRolesPanel";
import DeleteUserButton from "@/components/admin/users/DeleteUserButton";
import ResetMFAButton from "@/components/admin/users/ResetMFAButton";
import ResendInviteButton from "@/components/admin/users/ResendInviteButton";
import AccountTypeToggle from "@/components/admin/users/AccountTypeToggle";
import type { UserProfile } from "@/types/user-profile";
import type { Role } from "@/types/rbac";

import { checkPermission, requirePermission } from "@/lib/rbac";

export const metadata = { title: "Χρήστης — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:roles");
  const params = await props.params;
  const admin = createAdminClient();

  const [profileRes, allRolesRes, userRolesRes, authUserRes] = await Promise.all([
    admin.from("user_profiles").select("*").eq("id", params.id).maybeSingle(),
    admin.from("roles").select("*").order("name"),
    admin.from("user_roles").select("role_id").eq("user_id", params.id),
    admin.auth.admin.getUserById(params.id),
  ]);

  if (!profileRes.data) notFound();

  const profile = profileRes.data as UserProfile;
  const allRoles = (allRolesRes.data ?? []) as Role[];
  const initialRoleIds = ((userRolesRes.data ?? []) as { role_id: string }[]).map(
    (r) => r.role_id
  );

  // Onboarding state, derived from GoTrue's user object (the authoritative
  // source): a verified TOTP factor = fully enrolled; else confirmed/signed-in
  // = password set but MFA pending; else still just invited.
  const authUser = authUserRes.data?.user;
  const hasVerifiedFactor = (authUser?.factors ?? []).some(
    (f) => f.status === "verified"
  );
  const emailConfirmed = Boolean(
    authUser?.email_confirmed_at || authUser?.confirmed_at
  );
  const onboarding: "invited" | "password_set" | "enrolled" = hasVerifiedFactor
    ? "enrolled"
    : emailConfirmed || authUser?.last_sign_in_at
      ? "password_set"
      : "invited";

  // The page is gated on manage:roles; flipping account_type needs the
  // stronger manage:users, so the toggle only appears for those admins.
  const canManageUsers = await checkPermission("manage:users");

  return (
    <>
      <Link href="/admin/users" className="btn btn-secondary btn-sm mb-4">
        ← Πίσω στους χρήστες
      </Link>
      <header className="flex items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {profile.first_name} {profile.last_name}
            </h1>
            <span
              className={`cms-badge font-mono ${
                profile.account_type === "internal"
                  ? "cms-badge-neutral"
                  : "cms-badge-muted"
              }`}
            >
              {profile.account_type === "internal" ? "Εσωτερικός" : "Πελάτης"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{profile.email}</p>
          <p className="text-xs text-muted-foreground font-mono mt-1">{profile.id}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {canManageUsers && (
            <AccountTypeToggle
              userId={profile.id}
              current={profile.account_type}
            />
          )}
          <DeleteUserButton userId={profile.id} email={profile.email} />
        </div>
      </header>

      {profile.account_type === "internal" && (
        <section className="mb-6 rounded border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Onboarding:</span>
              <span
                className={`cms-badge font-mono ${
                  onboarding === "enrolled"
                    ? "cms-badge-neutral"
                    : "cms-badge-muted"
                }`}
              >
                {onboarding === "enrolled"
                  ? "Ολοκληρώθηκε (MFA)"
                  : onboarding === "password_set"
                    ? "Όρισε κωδικό — εκκρεμεί MFA"
                    : "Προσκλήθηκε — εκκρεμεί κωδικός"}
              </span>
            </div>
            {canManageUsers && onboarding === "invited" && (
              <ResendInviteButton userId={profile.id} />
            )}
          </div>
        </section>
      )}

      <UserRolesPanel
        userId={profile.id}
        allRoles={allRoles}
        initialRoleIds={initialRoleIds}
      />

      <section className="mt-8 space-y-2 text-sm">
        <h2 className="text-lg font-semibold">MFA</h2>
        <p className="text-xs text-muted-foreground">
          {hasVerifiedFactor
            ? "Ο χρήστης έχει ενεργό MFA. Επανεκδώστε token μόνο αν έχασε τη συσκευή του — το token εμφανίζεται μία φορά, παραδώστε το εκτός email."
            : "Εκδώστε token εγγραφής MFA για να ολοκληρώσει ο χρήστης την ενεργοποίηση. Εμφανίζεται μία φορά — παραδώστε το εκτός email."}
        </p>
        <ResetMFAButton
          userId={profile.id}
          userEmail={profile.email}
          hasVerifiedFactor={hasVerifiedFactor}
        />
      </section>

      <section className="mt-10 space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Στοιχεία λογαριασμού</h2>
        <dl className="grid grid-cols-2 gap-y-1 max-w-md">
          <dt className="text-muted-foreground">Τηλέφωνο</dt>
          <dd>{profile.phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Γλώσσα</dt>
          <dd>{profile.preferred_locale}</dd>
          <dt className="text-muted-foreground">Νόμισμα</dt>
          <dd>{profile.preferred_currency}</dd>
          <dt className="text-muted-foreground">Marketing</dt>
          <dd>{profile.marketing_opt_in ? "Ναι" : "Όχι"}</dd>
          <dt className="text-muted-foreground">Δημιουργία</dt>
          <dd>{new Date(profile.created_at).toLocaleString("el-GR")}</dd>
        </dl>
      </section>
    </>
  );
}
