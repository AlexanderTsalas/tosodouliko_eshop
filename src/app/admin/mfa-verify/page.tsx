import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VerifyMFAForm from "@/components/admin/mfa/VerifyMFAForm";

export const metadata = { title: "Επαλήθευση MFA — Admin" };
export const dynamic = "force-dynamic";

/**
 * Minimal shell — also NOT wrapped in AdminLayout (loop). Gates:
 *  - signed in
 *  - session is not yet AAL2 (else: nothing to do; → /admin)
 * If the user lands here with no verified TOTP factor, the client-side
 * VerifyMFAForm will bounce them to /admin/mfa-enroll on detection.
 */
export default async function MFAVerifyPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin");

  const { data: levelData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelData?.currentLevel === "aal2") redirect("/admin");

  return (
    <main className="container mx-auto max-w-md px-4 py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Επαλήθευση δεύτερου παράγοντα</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Για ασφάλεια, το admin panel απαιτεί επιπλέον κωδικό από την Authenticator
          εφαρμογή σας.
        </p>
      </header>
      <VerifyMFAForm />
    </main>
  );
}
