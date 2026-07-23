"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRole } from "@/actions/rbac/createRole";
import { updateRole } from "@/actions/rbac/updateRole";
import type { Role } from "@/types/rbac";

interface Props {
  role?: Role;
  mode: "create" | "edit";
}

export default function RoleForm({ role, mode }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    const base = {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
    };

    startTransition(async () => {
      if (mode === "create") {
        const r = await createRole(base);
        if (!r.success) {
          setError(r.error);
          return;
        }
        router.push(`/admin/roles/${r.data.id}/edit`);
      } else if (role) {
        const r = await updateRole({ id: role.id, ...base });
        if (!r.success) {
          setError(r.error);
          return;
        }
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="grid gap-3 max-w-lg">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Όνομα ρόλου *</span>
        <input
          name="name"
          required
          defaultValue={role?.name}
          placeholder="π.χ. content_editor"
          pattern="[a-z0-9_-]+"
          className="border rounded px-3 py-2 font-mono"
        />
        <span className="text-xs text-muted-foreground">
          Μόνο πεζά γράμματα, αριθμοί, _ ή -
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Περιγραφή</span>
        <textarea
          name="description"
          rows={2}
          defaultValue={role?.description ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending ? "Αποθήκευση..." : mode === "create" ? "Δημιουργία ρόλου" : "Αποθήκευση"}
      </button>
    </form>
  );
}
