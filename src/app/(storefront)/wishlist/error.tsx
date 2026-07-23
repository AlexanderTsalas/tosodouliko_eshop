"use client";

import StorefrontErrorState from "@/components/layout/StorefrontErrorState";
import { strings } from "@/config/strings";

export default function WishlistError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <StorefrontErrorState title={strings.errors.wishlistError} error={error} reset={reset} />;
}
