"use client";

import { useState } from "react";
import ImageLightbox from "@/components/admin/products/images/ImageLightbox";
import { usePanelControllerOptional } from "@/components/admin/products/PanelControllerContext";
import type { ProductImage } from "@/types/products";

/**
 * Three overlapping thumbnails representing a product at-a-glance in
 * the admin products table. Resting state shows three slightly-rotated
 * cards stacked; on hover they smoothly fan out side-by-side; on click
 * the full image set opens in a lightbox.
 *
 * Empty-state fallback:
 *   - 0 images  → a muted placeholder square
 *   - 1 image   → single thumb, no unfold animation
 *   - 2 images  → two-thumb stack
 *
 * Designed to be dropped into a table cell. The cell hosting this
 * component must carry `data-row-action` so the Phase-2 row-stretched
 * link doesn't intercept clicks — this component opens a lightbox,
 * not the row's destination page.
 */
export default function ProductThumbnailStack({
  images,
  productName,
  productId,
}: {
  /** Pre-resolved images (url already filled). Pass an empty array
   *  when the product has no images. */
  images: ProductImage[];
  /** Used for alt-text fallback + screen-reader announcement. */
  productName: string;
  /** When set (and a panel controller is present), the empty-state "+"
   *  opens this product's panel on the Images tab. */
  productId?: string;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const panel = usePanelControllerOptional();

  // Cap the stack at 3 thumbs visually — the lightbox shows the rest.
  const thumbs = images.slice(0, 3);

  if (thumbs.length === 0) {
    // "No Image" placeholder. When a product id + panel are available, it's
    // an actionable "+" that jumps to the Images tab; otherwise inert.
    if (productId && panel) {
      return (
        <button
          type="button"
          onClick={() => panel.open(productId, { tab: "images" })}
          title="Προσθήκη εικόνων"
          aria-label={`Προσθήκη εικόνων — ${productName}`}
          className="group/noimg relative w-12 h-12 rounded bg-muted/40 border border-dashed border-foreground/20 hover:border-foreground/40 hover:bg-muted/60 transition-colors flex items-center justify-center"
        >
          <span className="text-[8px] leading-tight text-center text-muted-foreground/60 px-0.5 group-hover/noimg:opacity-0 transition-opacity">
            No Image
          </span>
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/noimg:opacity-100 transition-opacity text-foreground/70 text-lg leading-none">
            +
          </span>
        </button>
      );
    }
    return (
      <div
        className="w-12 h-12 rounded bg-muted/40 border border-foreground/10 flex items-center justify-center text-[8px] text-muted-foreground/50"
        aria-label="Καμία εικόνα"
      >
        No Image
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label={`Προβολή εικόνων ${productName}`}
        // Fixed container width so the table column never reflows on
        // hover. The thumbnails fan within the container, not beyond
        // it. `group` makes child transitions react to container hover.
        className="group relative w-[108px] h-12 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 rounded"
      >
        {thumbs.map((img, idx) => (
          <div
            key={img.id}
            className={`absolute top-0 left-0 w-12 h-12 rounded border border-foreground/15 bg-background shadow-sm overflow-hidden transition-transform duration-200 ease-out ${STACK_CLASSES[thumbs.length - 1][idx]}`}
            style={{ zIndex: idx + 1 }}
          >
            {img.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.url}
                alt={img.alt_text ?? productName}
                className="w-full h-full object-cover"
                draggable={false}
              />
            ) : null}
          </div>
        ))}
      </button>

      {lightboxOpen && (
        <ImageLightbox
          images={images}
          startIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Pre-computed Tailwind class strings for each (totalThumbs, index)
 * pair. The classes encode:
 *   - Resting state: rotate + translateX so the thumbs overlap
 *   - Hover state (via group-hover:): no rotation + spread out
 *
 * Pre-computed (rather than constructed from numeric props at render
 * time) so Tailwind's JIT scanner sees the literal class strings and
 * compiles them. Dynamic class composition would silently fail in
 * production builds.
 */
const STACK_CLASSES: string[][] = [
  // 1 thumb — no rotation, no offset, no fan-out.
  ["translate-x-[30px]"],

  // 2 thumbs — gentle stagger, fan apart on hover.
  [
    "-rotate-[6deg] translate-x-[16px] group-hover:translate-x-[14px] group-hover:rotate-0",
    "rotate-[6deg] translate-x-[34px] group-hover:translate-x-[60px] group-hover:rotate-0",
  ],

  // 3 thumbs — full fan layout.
  [
    "-rotate-[10deg] translate-x-0 group-hover:translate-x-0 group-hover:rotate-0",
    "rotate-0 translate-x-[16px] group-hover:translate-x-[30px] group-hover:rotate-0",
    "rotate-[10deg] translate-x-[32px] group-hover:translate-x-[60px] group-hover:rotate-0",
  ],
];
