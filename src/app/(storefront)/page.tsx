import { Suspense } from "react";
import FoliageBackground from "@/components/layout/FoliageBackground";
import HeroSlideshow from "@/components/features/home/HeroSlideshow";
import FeaturedProducts from "@/components/features/home/FeaturedProducts";
import TaglineBand from "@/components/features/home/TaglineBand";
import CategoryTiles from "@/components/features/home/CategoryTiles";
import ContactStrip from "@/components/features/home/ContactStrip";

export const revalidate = 60;

/**
 * Storefront home — warm-artisan layout ported from the reference design and
 * wired to real data: hero slideshow → featured products → tagline band →
 * category tiles → contact strip. Sections keep transparent backgrounds where
 * appropriate so the parallax foliage shows through the side gutters.
 *
 * The data-bearing sections (featured, tiles) are wrapped in Suspense so the
 * hero paints immediately while product/category queries stream in.
 */
export default function HomePage() {
  return (
    <main className="bg-transparent">
      <FoliageBackground />
      <HeroSlideshow />
      <Suspense fallback={null}>
        <CategoryTiles />
      </Suspense>
      <TaglineBand />
      <Suspense fallback={null}>
        <FeaturedProducts />
      </Suspense>
      <ContactStrip />
    </main>
  );
}
