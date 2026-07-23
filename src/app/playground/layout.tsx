import { notFound } from "next/navigation";
import Link from "next/link";

export const metadata = { title: "Playground — UI Sandbox" };

/**
 * Standalone UI sandbox layout. Lives outside the /admin segment on
 * purpose — no admin sidebar, no MFA gate, no PageTransitionWrapper —
 * so we can iterate on a single page's visual design without other
 * chrome interfering.
 *
 * The sandbox reads from the SAME database the real CMS uses; any
 * destructive action triggered here (delete, bulk update) will hit
 * production data. The amber banner exists to make that obvious.
 *
 * Production gate: returns 404 in NODE_ENV=production so the sandbox
 * never ships to real users.
 */
export default function PlaygroundLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-amber-300/60 bg-amber-50/70 px-6 py-3">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-amber-400 bg-amber-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-900">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" aria-hidden />
              Playground
            </span>
            <p className="text-xs text-amber-900/80">
              Standalone UI sandbox · reads from the real database · destructive actions are live
            </p>
          </div>
          <Link
            href="/admin"
            className="text-xs text-amber-900/80 underline-offset-2 hover:underline"
          >
            ← Back to CMS
          </Link>
        </div>
      </header>
      <main className="px-6 lg:px-10 2xl:px-16 py-6">{children}</main>
    </div>
  );
}
