"use client";

import { useState, useTransition } from "react";
import { revokeSession } from "@/actions/session-management/revokeSession";
import type { UserSession } from "@/types/session-management";

export default function ActiveSessions({
  sessions: initialSessions,
}: {
  sessions: UserSession[];
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [pending, startTransition] = useTransition();

  function revoke(id: string) {
    const prev = sessions;
    setSessions((s) => s.filter((x) => x.id !== id));
    startTransition(async () => {
      const r = await revokeSession({ sessionId: id });
      if (!r.success) setSessions(prev);
    });
  }

  if (sessions.length === 0) {
    return <p className="text-muted-foreground">Δεν υπάρχουν ενεργές συνεδρίες.</p>;
  }

  return (
    <ul className="border border-stone-taupe/15 rounded-sm bg-card divide-y divide-stone-taupe/15 overflow-hidden">
      {sessions.map((s) => (
        <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-ink">{s.device_name ?? "Άγνωστη συσκευή"}</p>
            <p className="text-sm text-muted-foreground">
              {s.ip_address ?? "—"} · {new Date(s.last_active_at).toLocaleString("el-GR")}
            </p>
          </div>
          <button
            onClick={() => revoke(s.id)}
            disabled={pending}
            className="text-sm text-destructive hover:underline disabled:opacity-50"
          >
            Ανάκληση
          </button>
        </li>
      ))}
    </ul>
  );
}
