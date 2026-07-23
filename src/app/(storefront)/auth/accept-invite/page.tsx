import AcceptInviteForm from "@/components/features/auth/AcceptInviteForm";

export const metadata = { title: "Ορισμός κωδικού" };
export const dynamic = "force-dynamic";

/**
 * Landing page for admin-issued invite / recovery links. The token_hash is
 * read server-side from the query and handed to the client form as a prop
 * (avoids a useSearchParams Suspense boundary). The form verifies the token
 * and sets the user's password. Reachable pre-auth — middleware gates nothing.
 */
export default async function AcceptInvitePage(props: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const sp = await props.searchParams;
  return (
    <main className="container mx-auto px-4 py-12 max-w-md">
      <h1 className="text-2xl font-semibold mb-2">Καλωσορίσατε</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Ορίστε τον κωδικό πρόσβασής σας για να αποκτήσετε πρόσβαση στο
        διαχειριστικό.
      </p>
      <AcceptInviteForm tokenHash={sp.token_hash} type={sp.type} />
    </main>
  );
}
