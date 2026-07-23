import { searchVariants } from "@/lib/site-search";
import StorefrontProductCard from "@/components/features/products/StorefrontProductCard";
import SectionHeading from "@/components/features/home/SectionHeading";
import { strings } from "@/config/strings";

/**
 * Featured products band. No dedicated "featured" flag exists in the schema,
 * so this surfaces the first few active cards from the existing catalog search
 * (newest-first per searchVariants' default ordering). Reuses the canonical
 * StorefrontProductCard so featured tiles match the catalog exactly. Renders
 * nothing when there are no products yet.
 */
export default async function FeaturedProducts() {
  // 4×3 grid → up to 12 products.
  const result = await searchVariants({ limit: 12 });
  if (!result.success || result.data.cards.length === 0) return null;

  return (
    <section className="py-20 bg-transparent border-b border-stone-taupe/20">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow={strings.home.featured.eyebrow}
          title={strings.home.featured.title}
          subtitle={strings.home.featured.subtitle}
        />
        {/* 4 columns on desktop; the grid spans the full container so each
            card stays the same size as the previous 3-up layout. */}
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {result.data.cards.map((card, i) => (
            <StorefrontProductCard
              key={card.cardKey}
              card={card}
              offerRulesById={result.data.offer_rules_by_id}
              priorityImage={i < 4}
              layout="fluid"
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
