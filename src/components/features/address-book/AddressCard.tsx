"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteAddress } from "@/actions/addresses/deleteAddress";
import type { Address } from "@/types/address-book";

interface Props {
  address: Address;
}

export default function AddressCard({ address: a }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    if (!confirm(`Διαγραφή της διεύθυνσης "${a.label ?? a.address_line1}";`)) return;
    startTransition(async () => {
      const r = await deleteAddress({ address_id: a.id });
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="border border-stone-taupe/20 rounded-sm bg-card p-4 flex items-start justify-between gap-4">
      <div className="text-sm">
        <p className="font-medium text-ink">
          {a.label ?? `${a.first_name} ${a.last_name}`}
          {a.is_default_shipping && (
            <span className="ml-2 text-xs rounded-sm bg-warm-sand px-1.5 py-0.5 text-stone-taupe">
              default ship
            </span>
          )}
          {a.is_default_billing && (
            <span className="ml-2 text-xs rounded-sm bg-warm-sand px-1.5 py-0.5 text-stone-taupe">
              default bill
            </span>
          )}
        </p>
        <p className="text-muted-foreground">
          {a.first_name} {a.last_name}
        </p>
        <p className="text-muted-foreground">
          {a.address_line1}
          {a.address_line2 ? `, ${a.address_line2}` : ""}
        </p>
        <p className="text-muted-foreground">
          {a.postal_code} {a.city}
          {a.state ? `, ${a.state}` : ""} · {a.country_code}
        </p>
        {a.phone && <p className="text-muted-foreground text-xs mt-1">{a.phone}</p>}
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>
      <div className="flex flex-col gap-1 text-xs items-end">
        <Link
          href={`?edit=${a.id}`}
          scroll={false}
          className="rounded-sm border border-stone-taupe/30 px-3 py-1 hover:border-terracotta hover:text-terracotta transition-colors"
        >
          Επεξεργασία
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-sm border border-destructive/40 text-destructive px-3 py-1 hover:bg-destructive/10 transition-colors disabled:opacity-40"
        >
          {isPending ? "..." : "Διαγραφή"}
        </button>
      </div>
    </li>
  );
}
