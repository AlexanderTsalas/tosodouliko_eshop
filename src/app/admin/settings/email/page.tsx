import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { Pencil } from "@/components/admin/common/icons";
import EmailProviderForm from "@/components/admin/email-settings/EmailProviderForm";
import EmailProviderRowActions from "@/components/admin/email-settings/EmailProviderRowActions";
import type { EmailProviderConfig } from "@/types/email";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Email πάροχος — Admin" };
export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  smtp: "SMTP",
  resend: "Resend",
};

export default async function EmailSettingsPage(
  props: {
    searchParams: Promise<{ edit?: string }>;
  }
) {
  await requirePermission("manage:settings");
  const searchParams = await props.searchParams;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_provider_configs")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  const providers = (data ?? []) as EmailProviderConfig[];
  const editing =
    searchParams.edit && providers.find((p) => p.id === searchParams.edit);

  const masterKeyPresent = Boolean(process.env.EMAIL_SECRETS_KEY);

  return (
    <>
      <PageHeader
        eyebrow="Ρυθμίσεις"
        title="Πάροχος email"
        description="Διαχείριση του παρόχου που στέλνει τα emails του eshop (επιβεβαιώσεις παραγγελιών, ειδοποιήσεις αποστολής, password reset). Ένας πάροχος είναι ενεργός κάθε φορά."
      />

      {!masterKeyPresent && (
        <div className="rounded-lg border border-foreground bg-background p-4 mb-6 text-sm space-y-2">
          <p className="font-semibold flex items-center gap-2">
            <span className="cms-badge border-foreground bg-foreground text-background">
              SETUP
            </span>
            Λείπει το <code className="font-mono">EMAIL_SECRETS_KEY</code>
          </p>
          <p className="text-muted-foreground">
            Το master key για την κρυπτογράφηση των credentials δεν είναι
            ρυθμισμένο στο περιβάλλον. Δημιουργήστε ένα με:
          </p>
          <pre className="text-xs font-mono bg-muted px-3 py-2 rounded border border-foreground/10 overflow-x-auto">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </pre>
          <p className="text-xs text-muted-foreground">
            Προσθέστε τη γραμμή{" "}
            <code className="font-mono">EMAIL_SECRETS_KEY=...</code> στο{" "}
            <code className="font-mono">.env.local</code> (και στο Vercel για
            production). Μέχρι τότε δεν θα μπορείτε να αποθηκεύσετε credentials.
          </p>
        </div>
      )}

      {error && (
        <div className="cms-card border-destructive bg-destructive/5 text-sm text-destructive mb-4">
          Σφάλμα φόρτωσης: {error.message}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        {/* ─── Existing providers list (compact, sticky on xl+) ─── */}
        <section className="space-y-3 xl:sticky xl:top-6 xl:self-start">
          <header className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Διαμορφωμένοι πάροχοι
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {providers.length} συνολικά
            </span>
          </header>

          {providers.length === 0 ? (
            <div className="cms-empty">
              Δεν έχει διαμορφωθεί πάροχος ακόμη. Συμπληρώστε τη φόρμα δεξιά
              για να ξεκινήσετε.
            </div>
          ) : (
            <ul className="space-y-3">
              {providers.map((p) => (
                <li
                  key={p.id}
                  className={`cms-card transition-colors ${
                    editing && editing.id === p.id
                      ? "border-foreground"
                      : ""
                  }`}
                >
                  <header className="flex flex-wrap items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold tracking-tight">
                        {p.display_name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {p.is_active ? (
                          <span className="cms-badge cms-badge-neutral">
                            <span className="cms-badge-dot" aria-hidden />
                            Ενεργός
                          </span>
                        ) : (
                          <span className="cms-badge cms-badge-muted">
                            ανενεργός
                          </span>
                        )}
                        <span className="cms-badge cms-badge-muted">
                          {KIND_LABELS[p.kind] ?? p.kind}
                        </span>
                      </div>
                    </div>
                  </header>

                  <dl className="text-sm space-y-1 mb-3">
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground w-16 shrink-0">
                        From
                      </dt>
                      <dd className="font-mono text-xs truncate">
                        {p.from_address}
                      </dd>
                    </div>
                    {p.reply_to && (
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground w-16 shrink-0">
                          Reply-to
                        </dt>
                        <dd className="font-mono text-xs truncate">
                          {p.reply_to}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {p.last_test_at && (
                    <div className="rounded-md border border-foreground/10 bg-muted/30 px-2.5 py-1.5 text-xs mb-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            p.last_test_status === "success"
                              ? "bg-foreground"
                              : "bg-destructive"
                          }`}
                          aria-hidden
                        />
                        <span className="font-medium capitalize">
                          {p.last_test_status === "success"
                            ? "Επιτυχημένο test"
                            : "Αποτυχημένο test"}
                        </span>
                        <span className="text-muted-foreground">
                          · {new Date(p.last_test_at).toLocaleString("el-GR")}
                        </span>
                      </div>
                      {p.last_test_message && (
                        <p className="text-muted-foreground mt-0.5 truncate">
                          {p.last_test_message}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      href={`/admin/settings/email?edit=${p.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Επεξεργασία
                    </Link>
                    <EmailProviderRowActions
                      provider={p}
                      testEmailDefault={p.from_address}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── Form panel — takes the wider column ─── */}
        <section className="cms-card">
          <header className="flex items-center justify-between mb-4 pb-4 border-b border-foreground/10">
            <div className="flex items-baseline gap-3 min-w-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {editing ? "Επεξεργασία παρόχου" : "Νέος πάροχος"}
              </h2>
              {editing && (
                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded truncate">
                  {editing.display_name}
                </span>
              )}
            </div>
            {editing && (
              <Link
                href="/admin/settings/email"
                className="text-xs text-muted-foreground hover:text-foreground underline whitespace-nowrap"
              >
                ← Νέο
              </Link>
            )}
          </header>
          <EmailProviderForm initial={editing || undefined} />
        </section>
      </div>
    </>
  );
}
