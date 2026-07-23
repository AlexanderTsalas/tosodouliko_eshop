import PageHeader from "@/components/features/backoffice-shell/PageHeader";

const TABS = [
  { value: "carriers", label: "Μεταφορικές" },
  { value: "methods", label: "Τρόποι παράδοσης" },
  { value: "prefixes", label: "Μεγέθη πακέτου" },
  { value: "api", label: "API integrations" },
];

export default function CouriersLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Ρυθμίσεις"
        title="Μεταφορές & Couriers"
        description="Διαχειριστείτε ποιες μεταφορικές προσφέρετε στους πελάτες, τους τρόπους παράδοσης, και τα credentials των API integrations."
      />

      <nav className="cms-tabs" aria-label="Καρτέλες">
        {TABS.map((t, i) => (
          <span
            key={t.value}
            aria-current={i === 0 ? "page" : undefined}
            className="cms-tab"
          >
            {t.label}
          </span>
        ))}
      </nav>
    </>
  );
}
