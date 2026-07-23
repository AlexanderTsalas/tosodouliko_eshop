"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProductImage } from "@/types/products";

/**
 * Storefront full-screen image viewer. Same UX shape as the admin
 * lightbox but lives in the features tree because it's a customer-
 * facing concern (could evolve independently — pinch-zoom on mobile,
 * tap-to-cycle, etc.).
 *
 * Keyboard:
 *   - Esc      → close
 *   - ←, →     → navigate
 */
export default function ImageLightbox({
  images,
  startIndex,
  onClose,
}: {
  images: ProductImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(startIndex, images.length - 1))
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight")
        setIndex((i) => Math.min(images.length - 1, i + 1));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  if (images.length === 0) return null;
  const current = images[index];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Κλείσιμο"
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
      >
        <X className="w-7 h-7" />
      </button>

      {index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => Math.max(0, i - 1));
          }}
          aria-label="Προηγούμενη εικόνα"
          className="absolute left-4 text-white/80 hover:text-white p-2 z-10"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => Math.min(images.length - 1, i + 1));
          }}
          aria-label="Επόμενη εικόνα"
          className="absolute right-4 text-white/80 hover:text-white p-2 z-10"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {current.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current.url}
          alt={current.alt_text ?? ""}
          onClick={(e) => e.stopPropagation()}
          className="max-w-[95vw] max-h-[95vh] object-contain"
        />
      )}

      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
