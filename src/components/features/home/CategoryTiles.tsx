import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { getCategoryTree } from "@/lib/categories/getCategoryTree";
import SectionHeading from "@/components/features/home/SectionHeading";
import { strings } from "@/config/strings";

/**
 * Category browse tiles, wired to the real category tree (top-level
 * categories). Uses each category's image_url when set, otherwise falls back
 * to one of the bundled reference images so the grid always looks finished.
 * Links use the existing /products?category=<slug> route. Hidden entirely
 * until categories exist.
 */
const FALLBACK_IMAGES = [
  "/brand/category-baptism.png",
  "/brand/category-wedding.png",
  "/brand/category-clothes.png",
  "/brand/category-gifts.png",
];

export default async function CategoryTiles() {
  const tree = await getCategoryTree();
  if (tree.length === 0) return null;

  return (
    <section className="py-20 bg-transparent border-b border-stone-taupe/20">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow={strings.home.categoriesSection.eyebrow}
          title={strings.home.categoriesSection.title}
        />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {tree.map((cat, i) => {
            const img = cat.image_url ?? FALLBACK_IMAGES[i % FALLBACK_IMAGES.length];
            return (
              <Link
                key={cat.id}
                href={`/products?category=${cat.slug}`}
                className="group text-left p-3 border border-stone-taupe/15 hover:border-terracotta rounded-sm bg-canvas/70 shadow-[0_10px_30px_-12px_rgba(43,36,32,0.3)] hover:shadow-[0_20px_44px_-14px_rgba(43,36,32,0.42)] transition-all duration-300"
              >
                <div className="relative aspect-square overflow-hidden mb-3.5 bg-warm-sand rounded-sm">
                  <Image
                    src={img}
                    alt={cat.name}
                    fill
                    sizes="(min-width: 1024px) 18vw, (min-width: 768px) 30vw, 45vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-ink/5 group-hover:bg-transparent transition-colors duration-300" />
                </div>
                <div className="flex items-center justify-center gap-1.5 px-1">
                  <span className="font-serif text-base sm:text-lg font-bold text-ink group-hover:text-terracotta transition-colors">
                    {cat.name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-stone-taupe group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
