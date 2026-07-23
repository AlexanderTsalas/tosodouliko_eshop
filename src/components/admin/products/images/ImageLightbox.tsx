"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProductImage } from "@/types/products";

/**
 * Full-screen overlay showing one image at maximum quality. Keyboard:
 *   - Esc      → close
 *   - ←, →     → navigate previous/next within the active image set
 *
 * Click backdrop also closes. Click on image itself does nothing
 * (prevents accidental close while admins zoom on detail).
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
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(images.length - 1, i + 1));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  if (images.length === 0) return null;
  if (typeof document === "undefined") return null;
  const current = images[index];

  // Portaled to <body> so it escapes the table-row stacking context
  // (.cms-row-link is position:relative;z-index:0 — a fixed child would
  // otherwise be painted over by later rows). z-[80] sits above the dock
  // (50), panel (60) and bulk modal (70).
  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center"
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
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
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
          className="absolute left-4 text-white/80 hover:text-white p-2"
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
          className="absolute right-4 text-white/80 hover:text-white p-2"
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
          className="max-w-[90vw] max-h-[90vh] object-contain"
        />
      )}

      {current.alt_text && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm max-w-2xl text-center px-4">
          {current.alt_text}
        </div>
      )}

      {images.length > 1 && (
        <div className="absolute top-4 left-4 text-white/70 text-sm tabular-nums">
          {index + 1} / {images.length}
        </div>
      )}
    </div>,
    document.body
  );
}
