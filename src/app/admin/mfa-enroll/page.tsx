import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isInternalUser } from "@/lib/rbac";
import { validateEnrollmentToken } from "@/lib/mfa/validateEnrollmentToken";
import EnrollMFAForm from "@/components/admin/mfa/EnrollMFAForm";

export const metadata = { title: "Ενεργοποίηση MFA — Admin" };
export const dynamic = "force-dynamic";

/**
 * Bare shell — deliberately NOT wrapped in AdminLayout, which would
 * redirect us back here in a loop via requireMFA().
 *
 * Security gates (in order):
 *   1. Signed in
 *   2. Is an internal (back-office) user
 *   3. Session is not yet AAL2 (else: bounce to /admin)
 *   4. No verified TOTP factors yet (else: send to /admin/mfa-verify)
 *   5. Valid, unconsumed, unexpired enrollment token in ?token=...
 *      bound to the SAME user the session belongs to.
 *
 * The token gate is what closes the password-only attack window: an
 * attacker holding a leaked admin password CANNOT reach the QR without
 * also having a token, which is only mintable by an existing admin and
 * delivered out-of-band.
 *
 * When a logged-in user without a token lands here, we render a "contact
 * your administrator" page instead of the QR. We deliberately don't
 * differentiate "no token" from "invalid token" in the UX to deny
 * information about token validity to anyone fishing for a leaked code.
 */
export default async function MFAEnrollPage(
  props: {
    searchParams: Promise<{ token?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin");

  // Only internal (back-office) users enroll in MFA. This replaces an ad-hoc
  // OR of three permission checks with the authoritative coarse boundary.
  if (!(await isInternalUser())) redirect("/");

  const { data: levelData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelData?.currentLevel === "aal2") redirect("/admin");

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verifiedTotp = factorsData?.totp?.filter((f) => f.status === "verified") ?? [];
  if (verifiedTotp.length > 0) redirect("/admin/mfa-verify");

  // Token gate.
  const rawToken = searchParams.token?.trim();
  const validated = rawToken ? await validateEnrollmentToken(rawToken) : null;
  const tokenOk = validated !== null && validated.userId === authData.user.id;

  if (!tokenOk) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-12">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Ενεργοποίηση δεύτερου παράγοντα</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Για την ασφάλεια του λογαριασμού, η εγγραφή MFA απαιτεί ένα
            μοναδικό token που σας παρέχει ο διαχειριστής σας εκτός
            ηλεκτρονικής πλατφόρμας (π.χ. αυτοπροσώπως ή με ασφαλές μήνυμα).
          </p>
        </header>

        <div className="rounded border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
          <p className="font-medium">⚠ Δεν εντοπίστηκε έγκυρο token εγγραφής.</p>
          <p>
            Επικοινωνήστε με τον διαχειριστή του συστήματος για να σας εκδώσει
            ένα νέο token. Όταν το λάβετε, ανοίξτε τον σύνδεσμο που σας έδωσε
            ή προσθέστε <code className="font-mono text-xs">?token=...</code>
            {" "}στη γραμμή διεύθυνσης.
          </p>
        </div>

        <div className="mt-6 text-xs text-muted-foreground">
          <Link href="/auth/signout" className="underline">
            Αποσύνδεση
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Ενεργοποίηση δεύτερου παράγοντα</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Η πρόσβαση στο admin panel απαιτεί δεύτερο παράγοντα ταυτοποίησης (MFA).
          Ολοκληρώστε την εγγραφή για να συνεχίσετε.
        </p>
      </header>
      <EnrollMFAForm enrollmentToken={rawToken!} />
    </main>
  );
}
