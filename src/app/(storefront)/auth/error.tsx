"use client";

import StorefrontErrorState from "@/components/layout/StorefrontErrorState";
import { strings } from "@/config/strings";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <StorefrontErrorState title={strings.errors.authError} error={error} reset={reset} />;
}
