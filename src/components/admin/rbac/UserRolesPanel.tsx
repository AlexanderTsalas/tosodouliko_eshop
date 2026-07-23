"use client";

import { useState, useTransition } from "react";
import { assignRole } from "@/actions/rbac/assignRole";
import { revokeRole } from "@/actions/rbac/revokeRole";
import type { Role } from "@/types/rbac";

interface Props {
  userId: string;
  allRoles: Role[];
  initialRoleIds: string[];
}

export default function UserRolesPanel({ userId, allRoles, initialRoleIds }: Props) {
  const [assigned, setAssigned] = useState<Set<string>>(new Set(initialRoleIds));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(roleId: string) {
    setError(null);
    const prev = new Set(assigned);
    const has = prev.has(roleId);

    const next = new Set(prev);
    if (has) next.delete(roleId);
    else next.add(roleId);
    setAssigned(next);

    startTransition(async () => {
      const r = has
        ? await revokeRole({ userId, roleId })
        : await assignRole({ userId, roleId });
      if (!r.success) {
        setError(r.error);
        setAssigned(prev);
      }
    });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Ρόλοι χρήστη</h2>
      {allRoles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Δεν υπάρχουν ρόλοι.</p>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {allRoles.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 text-sm border rounded px-3 py-2">
                <input
                  type="checkbox"
                  checked={assigned.has(r.id)}
                  onChange={() => toggle(r.id)}
                  disabled={isPending}
                />
                <div className="min-w-0">
                  <p className="font-medium">{r.name}</p>
                  {r.description && (
                    <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                  )}
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
