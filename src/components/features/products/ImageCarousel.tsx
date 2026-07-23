"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ImageLightbox from "./ImageLightbox";
import type { ProductImage } from "@/types/products";

/**
 * Storefront product gallery — large main image + a thumbnail rail (vertical
 * beside the image on desktop, horizontal under it on mobile). Click a
 * thumbnail to swap the main image; arrows step through; click the main image
 * to open the full-size lightbox. Resets to the first image when the set
 * changes (variant picker swap on the PDP).
 */
export default function ImageCarousel({
  images,
  alt,
  priority = false,
}: {
  images: ProductImage[];
  alt: string;
  priority?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const imagesKey = images.map((i) => i.id).join(",");
  useEffect(() => {
    setActiveIndex(0);
  }, [imagesKey]);

  if (images.length === 0) {
    return (
      <div className="relative aspect-square rounded-sm border border-stone-taupe/30 bg-warm-sand" aria-hidden="true" />
    );
  }

  const active = images[activeIndex] ?? images[0];
  const goPrev = () => setActiveIndex((i) => (i === 0 ? images.length - 1 : i - 1));
  const goNext = () => setActiveIndex((i) => (i + 1) % images.length);
  const hasMany = images.length > 1;

  return (
    <>
      <div className="flex flex-col-reverse md:flex-row gap-3">
        {/* Thumbnail rail */}
        {hasMany && (
          <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto md:max-h-[560px] md:w-20 shrink-0 pb-1 md:pb-0">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveIndex(i)}
                aria-label={`Εικόνα ${i + 1}`}
                aria-current={i === activeIndex}
                className={`relative shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-sm overflow-hidden border transition-colors ${
                  i === activeIndex
                    ? "border-terracotta ring-1 ring-terracotta"
                    : "border-stone-taupe/30 hover:border-stone-taupe"
                }`}
              >
                {img.url ? (
                  <Image src={img.url} alt={img.alt_text ?? alt} fill sizes="80px" className="object-cover" />
                ) : (
                  <div className="w-full h-full bg-warm-sand" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Main image */}
        <div className="relative flex-1 aspect-square overflow-hidden rounded-sm border border-stone-taupe/30 bg-warm-sand shadow-[0_16px_40px_-16px_rgba(43,36,32,0.32)]">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="absolute inset-0 cursor-zoom-in"
            aria-label="Άνοιγμα εικόνας σε λεπτομερή προβολή"
          >
            {active?.url ? (
              <Image
                key={active.id}
                src={active.url}
                alt={active.alt_text ?? alt}
                fill
                priority={priority}
                sizes="(min-width: 768px) 45vw, 100vw"
                quality={80}
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full bg-warm-sand" />
            )}
          </button>

          {hasMany && (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="Προηγούμενη εικόνα"
                className="absolute top-1/2 left-2 -translate-y-1/2 p-1.5 rounded-full bg-canvas/90 hover:bg-canvas shadow-sm text-ink/80 hover:text-terracotta transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Επόμενη εικόνα"
                className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 rounded-full bg-canvas/90 hover:bg-canvas shadow-sm text-ink/80 hover:text-terracotta transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {lightboxOpen && (
        <ImageLightbox
          images={images}
          startIndex={activeIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
