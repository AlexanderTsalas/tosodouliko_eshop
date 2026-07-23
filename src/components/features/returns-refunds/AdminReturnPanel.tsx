"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ReturnRequest } from "@/types/returns-refunds";

export default function AdminReturnPanel({
  initialRequests,
}: {
  initialRequests: ReturnRequest[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [pending, startTransition] = useTransition();

  function decide(id: string, decision: "approved" | "rejected") {
    const prev = requests;
    setRequests((r) =>
      r.map((x) => (x.id === id ? { ...x, status: decision } : x))
    );
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("return_requests")
        .update({
          status: decision,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) setRequests(prev);
    });
  }

  if (requests.length === 0) {
    return <p className="text-muted-foreground">Δεν υπάρχουν εκκρεμείς επιστροφές.</p>;
  }

  return (
    <ul className="divide-y">
      {requests.map((r) => (
        <li key={r.id} className="py-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">{r.reason.slice(0, 80)}</p>
            <p className="text-sm text-muted-foreground">{r.status}</p>
          </div>
          {r.status === "pending" && (
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => decide(r.id, "approved")}
                className="text-sm underline"
              >
                Αποδοχή
              </button>
              <button
                disabled={pending}
                onClick={() => decide(r.id, "rejected")}
                className="text-sm text-destructive underline"
              >
                Απόρριψη
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
