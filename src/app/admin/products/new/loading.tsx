import AdminPageHeader from "@/components/admin/common/AdminPageHeader";

export default function NewProductLoading() {
  return (
    <AdminPageHeader
      backHref="/admin/products"
      backLabel="Όλα τα προϊόντα"
      title="Νέο προϊόν"
      subtitle={
        <span className="max-w-2xl block">
          Όλα τα βασικά στοιχεία σε ένα βήμα — οι ίδιες ενότητες με τη
          σελίδα επεξεργασίας. Μετά τη δημιουργία θα μεταφερθείτε στις
          παραλλαγές για να ορίσετε άξονες (χρώμα, μέγεθος κ.λπ.) και να
          αναθέσετε προμηθευτές με κόστος.
        </span>
      }
    />
  );
}
