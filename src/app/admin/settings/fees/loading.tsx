import PageHeader from "@/components/features/backoffice-shell/PageHeader";

export default function FeesLoading() {
  return (
    <PageHeader
      eyebrow="Ρυθμίσεις"
      title="Χρεώσεις & κόμιστρα"
      description={
        <>
          Ορίστε κατηγορίες χρεώσεων (μεταφορικά, αντικαταβολή, και όποιες δικές
          σας χρειάζεστε) και κανόνες που καθορίζουν πόσο χρεώνεται κάθε
          παραγγελία. Σε σύγκρουση κανόνων κερδίζει το πιο συγκεκριμένο
          scope: variant &gt; product &gt; category &gt; global.
        </>
      }
    />
  );
}
