import Link from "next/link";
import SignupForm from "@/components/features/auth/SignupForm";
import BrandLogo from "@/components/layout/BrandLogo";
import { strings } from "@/config/strings";

export const metadata = { title: strings.auth.signUpTitle };

export default async function SignUpPage(
  props: {
    searchParams: Promise<{ next?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  // Preserve the originating URL across the email-verification round-trip
  // so wishlist / notify-me callers land back on the right page.
  const next = searchParams.next ?? "/";
  const signinHref = `/auth/signin?next=${encodeURIComponent(next)}`;
  return (
    <main className="container mx-auto px-4 py-12 sm:py-16 max-w-md">
      <div className="rounded-sm border border-stone-taupe/25 bg-card shadow-sm p-6 sm:p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <Link href="/" className="group mb-4">
            <BrandLogo size="sm" />
          </Link>
          <h1 className="font-serif text-2xl font-bold text-ink">{strings.auth.signUpHeading}</h1>
          <div className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mt-3" />
        </div>
        <SignupForm next={next} />
        <p className="mt-5 text-sm text-center text-ink/70">
          {strings.auth.haveAccount}{" "}
          <Link href={signinHref} className="text-terracotta hover:underline font-medium">
            {strings.auth.signInButton}
          </Link>
        </p>
      </div>
    </main>
  );
}
