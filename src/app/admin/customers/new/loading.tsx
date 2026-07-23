import Link from "next/link";

export default function NewCustomerLoading() {
  return (
    <>
      <Link href="/admin/customers" className="btn btn-secondary btn-sm mb-4">
        ← Πίσω στους πελάτες
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Νέος πελάτης</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Δημιουργία πελάτη χωρίς λογαριασμό χρήστη (για τηλεφωνικές παραγγελίες,
          πελάτες σε κατάστημα ή χειροκίνητη καταχώρηση).
        </p>
      </header>
    </>
  );
}
