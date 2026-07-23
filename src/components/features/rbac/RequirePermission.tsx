"use client";

import { usePermission } from "@/hooks/usePermission";

/**
 * Conditionally renders children based on a permission check. UX-only —
 * server actions / RSC must re-validate independently.
 */
export default function RequirePermission({
  permission,
  fallback = null,
  children,
}: {
  permission: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { data, isLoading } = usePermission(permission);
  if (isLoading) return null;
  if (!data) return <>{fallback}</>;
  return <>{children}</>;
}
