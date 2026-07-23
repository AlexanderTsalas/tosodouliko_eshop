"use client";

import { Star, Trash2, GripVertical, Pencil } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProductImage } from "@/types/products";

/**
 * Single image card with action affordances:
 *   - Click body → opens lightbox at full size
 *   - Star icon top-right (filled if is_cover) → toggles cover
 *   - Trash icon top-right → removes the (product_images) row
 *   - Drag-handle top-left → reorder within group via @dnd-kit
 *
 * "Cover" semantics: per attribute_combo group on this product. The
 * server action enforces single-cover-per-group atomically; this
 * component just fires the action.
 *
 * "Delete" semantics: removes the product_images row only. The
 * underlying media_assets row + storage bytes stay so the image
 * remains reusable from the media library.
 *
 * Drag semantics: a dedicated drag handle (GripVertical icon) is the
 * ONLY draggable surface. The image body + action buttons + cover
 * badge stay click-only so the existing UX (click → lightbox,
 * click star → toggle cover) keeps working. Restricting drag to the
 * handle prevents accidental reorders when admins click toggle
 * buttons.
 */
export default function ImageThumbnail({
  image,
  onSetCover,
  onDelete,
  onClick,
  onEditMetadata,
  pending = false,
}: {
  image: ProductImage;
  onSetCover: () => void;
  onDelete: () => void;
  onClick: () => void;
  /** Optional — when provided, a pencil icon appears with the other
   *  hover affordances and opens the metadata dialog. Left optional
   *  so callers that don't yet support metadata editing (e.g. read-
   *  only previews) can omit it. */
  onEditMetadata?: () => void;
  pending?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  // Compose the transform: dnd-kit's translate3d for follow-cursor +
  // a small scale during drag for a visible "lift". Combining them in
  // ONE inline transform string avoids the Tailwind-variable-vs-inline
  // conflict (Tailwind scale-* utilities set transform via CSS vars,
  // which inline transform overrides — the scale would never render).
  const baseTransform = CSS.Transform.toString(transform) ?? "";
  const composedTransform = isDragging
    ? `${baseTransform} scale(1.04)`.trim()
    : baseTransform || undefined;

  const style = {
    transform: composedTransform,
    // dnd-kit-managed transition for sibling layout-shift smoothness.
    // We deliberately do NOT layer a Tailwind transition-all on top,
    // since it would fight this on the transform property.
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      // Targeted Tailwind transitions: shadow + border-color animate on
      // hover/drag, but transform stays under dnd-kit's exclusive
      // control to avoid the "cracky" double-transition feel.
      className={`group relative aspect-square overflow-hidden rounded-lg border border-foreground/10 bg-muted/30 shadow-sm transition-[box-shadow,border-color] duration-200 hover:shadow-md hover:border-foreground/20 ${
        pending ? "opacity-50 pointer-events-none" : ""
      } ${isDragging ? "shadow-2xl ring-2 ring-foreground/40 cursor-grabbing" : ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        // While dragging, suppress click-to-lightbox + interactive
        // affordances. Without this, releasing the drag over a thumb
        // can accidentally fire the lightbox.
        disabled={isDragging}
        className={`absolute inset-0 ${
          isDragging ? "cursor-grabbing" : "cursor-zoom-in"
        }`}
        aria-label="Άνοιγμα εικόνας σε λεπτομερή προβολή"
      >
        {image.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.alt_text ?? ""}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full" />
        )}
      </button>

      {/* Top-left drag handle — the only draggable surface, so click
          handlers on the body + buttons keep working as before. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Αλλαγή σειράς εικόνας"
        className="absolute top-1.5 left-1.5 p-1.5 rounded-md bg-background/95 text-foreground/70 hover:text-foreground shadow-sm opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {/* Top-right action stack. Hidden while dragging so the cursor
          stays focused on the drag operation and accidental star/trash
          taps can't happen on release. */}
      <div
        className={`absolute top-1.5 right-1.5 flex gap-1.5 transition-opacity ${
          isDragging
            ? "opacity-0 pointer-events-none"
            : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetCover();
          }}
          aria-pressed={image.is_cover}
          aria-label={image.is_cover ? "Είναι εξώφυλλο" : "Ορισμός ως εξώφυλλο"}
          className={`p-1.5 rounded-md shadow-sm transition-colors ${
            image.is_cover
              ? "bg-amber-500 text-white"
              : "bg-background/95 text-foreground/70 hover:text-amber-500"
          }`}
        >
          <Star
            className="w-3.5 h-3.5"
            fill={image.is_cover ? "currentColor" : "none"}
          />
        </button>
        {onEditMetadata && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditMetadata();
            }}
            aria-label="Επεξεργασία μεταδεδομένων"
            className="p-1.5 rounded-md bg-background/95 text-foreground/70 hover:text-foreground shadow-sm transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Αφαίρεση εικόνας"
          className="p-1.5 rounded-md bg-background/95 text-foreground/70 hover:text-destructive shadow-sm transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cover badge (visible when not hovering, so admin knows which is cover at a glance) */}
      {image.is_cover && (
        <span className="absolute bottom-2 left-2 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md bg-amber-500 text-white shadow-md flex items-center gap-1 group-hover:opacity-0 transition-opacity">
          <Star className="w-3 h-3" fill="currentColor" />
          Εξώφυλλο
        </span>
      )}
    </div>
  );
}
