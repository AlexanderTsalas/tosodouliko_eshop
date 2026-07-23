"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteShippingZone } from "@/actions/shipping/deleteShippingZone";
import { deleteShippingRate } from "@/actions/shipping/deleteShippingRate";
import DeleteButton from "@/components/admin/common/DeleteButton";

export function DeleteZoneButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function go() {
    if (!confirm("Διαγραφή ζώνης; Οι συνδεδεμένες χρεώσεις χάνουν αναφορά.")) return;
    startTransition(async () => {
      const r = await deleteShippingZone({ id });
      if (r.success) router.refresh();
      else alert(r.error);
    });
  }
  return <DeleteButton onClick={go} label="Διαγραφή" disabled={isPending} />;
}

export function DeleteRateButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function go() {
    if (!confirm("Διαγραφή χρέωσης αποστολής;")) return;
    startTransition(async () => {
      const r = await deleteShippingRate({ id });
      if (r.success) router.refresh();
      else alert(r.error);
    });
  }
  return <DeleteButton onClick={go} label="Διαγραφή" disabled={isPending} />;
}
