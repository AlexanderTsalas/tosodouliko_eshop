"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftProduct } from "@/actions/products/createDraftProduct";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";

/**
 * "New Product" — creates a blank DRAFT row (active=false, is_draft=true)
 * and refreshes so it appears at the top of the table. Pressing it again
 * stacks more drafts ("Νέο προϊόν #2", "#3" …).
 *
 * Keyboard: **Shift + A** does the same. If the side panel is already open
 * (mid-configuration), it also jumps the panel straight to the new draft on
 * its Overview tab — basic info first. The shortcut is ignored while a text
 * field is focused so it never hijacks typing a capital "A".
 */
export default function NewProductButton() {
  const router = useRouter();
  const { isOpen, open } = usePanelController();
  const [isPending, startTransition] = useTransition();

  function addDraft() {
    startTransition(async () => {
      const r = await createDraftProduct();
      if (r.success) router.refresh();
    });
  }

  // Shift + A → create a draft; if the panel is open, open the new draft on
  // the Overview tab to continue configuring immediately.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.toLowerCase() !== "a") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      startTransition(async () => {
        const r = await createDraftProduct();
        if (!r.success) return;
        router.refresh();
        if (isOpen) open(r.data.id, { tab: "overview" });
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, open, router, startTransition]);

  return (
    <button
      type="button"
      onClick={addDraft}
      disabled={isPending}
      title="Νέο προϊόν (Shift + A)"
      className="btn btn-primary btn-md disabled:opacity-60"
    >
      <span className="text-base leading-none">+</span>{" "}
      {isPending ? "Προσθήκη…" : "Νέο προϊόν"}
    </button>
  );
}
