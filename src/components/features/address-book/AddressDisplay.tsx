/**
 * Renders an address snapshot as a human-readable block. Handles both shapes
 * the system writes into `orders.shipping_address` / `orders.billing_address`:
 *
 *   1. A full row copied from the `addresses` table when the customer picked
 *      a saved address at checkout — has first_name, last_name,
 *      address_line1, address_line2, city, state, postal_code,
 *      country_code, phone, label, plus the FK-level fields
 *      (id, customer_id, is_default*, created_at).
 *
 *   2. An inline form payload from admin manual-order entry — has
 *      recipient_name, street, address_line2, city, state, postal_code,
 *      country_code, phone, notes.
 *
 * The component reads either shape defensively (no type narrowing required
 * from the caller) and falls back to a muted "—" when the address is null
 * or empty.
 */
interface Props {
  address: Record<string, unknown> | null | undefined;
  /** Text to show when address is null/empty. Defaults to "—". */
  fallback?: string;
  className?: string;
}

export default function AddressDisplay({ address, fallback = "—", className }: Props) {
  if (!address || typeof address !== "object" || Object.keys(address).length === 0) {
    return <span className="text-muted-foreground text-sm">{fallback}</span>;
  }

  const a = address as Record<string, string | null | undefined>;

  // Reconcile both shapes: prefer the address-book fields, fall back to the
  // inline-form fields, then degrade to whatever's set.
  const fullName = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
  const name = fullName || a.recipient_name || null;
  const street = a.address_line1 || a.street || null;
  const line2 = a.address_line2 || null;

  const cityLine =
    [a.postal_code, a.city].filter(Boolean).join(" ").trim() +
    (a.state ? `, ${a.state}` : "");

  return (
    <address className={`not-italic text-sm space-y-0.5 ${className ?? ""}`}>
      {a.label && (
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {a.label}
        </p>
      )}
      {name && <p className="font-medium">{name}</p>}
      {street && (
        <p className="text-muted-foreground">
          {street}
          {line2 ? `, ${line2}` : ""}
        </p>
      )}
      {cityLine.trim() && <p className="text-muted-foreground">{cityLine}</p>}
      {a.country_code && (
        <p className="text-muted-foreground">{a.country_code}</p>
      )}
      {a.phone && (
        <p className="text-muted-foreground text-xs mt-1">📞 {a.phone}</p>
      )}
      {a.notes && (
        <p className="text-muted-foreground text-xs mt-1 italic">
          &quot;{a.notes}&quot;
        </p>
      )}
    </address>
  );
}
