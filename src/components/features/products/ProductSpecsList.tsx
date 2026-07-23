import type { ProductSpecificationView } from "@/types/product-specifications";

interface Props {
  specs: ProductSpecificationView[];
}

/**
 * Read-only specification sheet for the storefront product detail page.
 * Renders in a definition-list layout. Hidden entirely when the product
 * has no specs.
 */
export default function ProductSpecsList({ specs }: Props) {
  if (specs.length === 0) return null;
  return (
    <section className="border border-stone-taupe/20 rounded-sm bg-card p-5 max-w-2xl">
      <h2 className="font-serif text-lg font-bold text-ink mb-3">Προδιαγραφές</h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
        {specs.map((s) => (
          <div key={s.id} className="contents">
            <dt className="text-stone-taupe">{s.attribute_name}</dt>
            <dd className="font-medium text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
