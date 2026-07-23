"use client";

import { useState, useTransition } from "react";
import { updateSubscriber } from "@/actions/newsletter-sync/updateSubscriber";
import type { NewsletterSubscriber } from "@/types/newsletter-sync";

/**
 * Per-row interactive controls for the newsletter subscribers table.
 * Inherits cell padding from .cms-table tbody td — no extra padding
 * needed here, so the row aligns with the surrounding rows.
 */
export default function NewsletterRow({ row }: { row: NewsletterSubscriber }) {
  const [status, setStatus] = useState(row.status);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = status === "subscribed" ? "unsubscribed" : "subscribed";
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const r = await updateSubscriber({ id: row.id, status: next });
      if (!r.success) setStatus(prev);
    });
  }

  return (
    <tr>
      <td className="font-medium">{row.email}</td>
      <td>
        {status === "subscribed" ? (
          <span className="cms-badge cms-badge-neutral">
            <span className="cms-badge-dot" aria-hidden />
            subscribed
          </span>
        ) : status === "pending" ? (
          <span className="cms-badge border-foreground/40 bg-background font-semibold">
            pending
          </span>
        ) : (
          <span className="cms-badge cms-badge-muted">unsubscribed</span>
        )}
      </td>
      <td className="text-xs text-muted-foreground">
        {new Date(row.consent_at).toLocaleDateString("el-GR")}
      </td>
      <td className="text-center">
        <button
          onClick={toggle}
          disabled={isPending || status === "pending"}
          className="btn btn-secondary btn-sm"
        >
          {status === "subscribed" ? "Unsubscribe" : "Re-subscribe"}
        </button>
      </td>
    </tr>
  );
}
