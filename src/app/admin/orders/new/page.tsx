import Link from "next/link";
import NewOrderForm from "@/components/admin/orders/NewOrderForm";
import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέα παραγγελία — Admin" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  await requirePermission("manage:orders");
  return (
    <>
      <Link href="/admin/orders" className="btn btn-secondary btn-sm mb-4">
        ← Πίσω στις παραγγελίες
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Νέα παραγγελία</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Χειροκίνητη δημιουργία παραγγελίας (τηλεφωνική ή σε κατάστημα). Για
          ηλεκτρονικές παραγγελίες με Stripe χρησιμοποιείται η φόρμα
          ολοκλήρωσης παραγγελίας από τον πελάτη.
        </p>
      </header>
      <NewOrderForm />
    </>
  );
}
