import AdminPageHeader from "@/components/admin/common/AdminPageHeader";

export default function RelatedProductsLoading() {
  return (
    <AdminPageHeader
      title="Προτεινόμενα προϊόντα"
      subtitle={
        <span className="max-w-2xl block">
          Φτιάξτε συσχετίσεις που εμφανίζουν προτεινόμενα προϊόντα στις
          σελίδες προϊόντων με βάση κατηγορίες, χαρακτηριστικά ή
          συγκεκριμένες επιλογές. Κάθε συσχέτιση έχει δικό της τίτλο
          καρουζέλ και κανόνες ταιριάσματος.
        </span>
      }
    />
  );
}
