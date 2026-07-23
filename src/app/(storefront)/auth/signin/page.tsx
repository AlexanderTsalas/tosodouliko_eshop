import Link from "next/link";
import LoginForm from "@/components/features/auth/LoginForm";
import BrandLogo from "@/components/layout/BrandLogo";
import { strings } from "@/config/strings";

export const metadata = { title: strings.auth.signInTitle };

export default async function SignInPage(
  props: {
    searchParams: Promise<{ error?: string; next?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  return (
    <main className="container mx-auto px-4 py-12 sm:py-16 max-w-md">
      <div className="rounded-sm border border-stone-taupe/25 bg-card shadow-sm p-6 sm:p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <Link href="/" className="group mb-4">
            <BrandLogo size="sm" />
          </Link>
          <h1 className="font-serif text-2xl font-bold text-ink">{strings.auth.signInTitle}</h1>
          <div className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mt-3" />
        </div>
        {searchParams.error && (
          <div role="alert" className="mb-4 rounded-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {searchParams.error}
          </div>
        )}
        <LoginForm />
        <p className="mt-5 text-sm text-center text-ink/70">
          {strings.auth.noAccount}{" "}
          <Link href="/auth/signup" className="text-terracotta hover:underline font-medium">
            {strings.auth.createAccountLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
