"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, Image as ImageIcon, Plus } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import ImageThumbnail from "./ImageThumbnail";
import type { ProductImage } from "@/types/products";

export interface UploadProgressEntry {
  id: string; // local id (uuid)
  filename: string;
  stage: "processing" | "uploading" | "recording";
  error?: string;
}

/**
 * Right pane. Shows the active group's images + upload affordance.
 * Sticky relative to the page scroll so admin can scroll the left
 * list without losing the editing context.
 *
 * Drag-and-drop reorder: each thumbnail's drag handle (top-left grip
 * icon) is the draggable surface. Drop reorders within the current
 * group via the parent's onReorder callback, which fires
 * reorderProductImagesInGroup on the server with optimistic UI on
 * the client.
 *
 * Activation threshold (8px) prevents accidental drags when admins
 * just click the handle without intending to drag. Keyboard sensor
 * is wired so the reorder is usable without a pointer (admin
 * accessibility).
 */
export default function ImageEditPane({
  groupLabel,
  images,
  uploading,
  onUpload,
  onOpenLightbox,
  onSetCover,
  onDelete,
  onOpenMediaPicker,
  onReorder,
  onEditMetadata,
}: {
  groupLabel: string;
  images: ProductImage[];
  uploading: UploadProgressEntry[];
  onUpload: (files: File[]) => void;
  onOpenLightbox: (imageIndex: number) => void;
  onSetCover: (imageId: string) => void;
  onDelete: (imageId: string) => void;
  onOpenMediaPicker: () => void;
  onReorder: (imageIdsInOrder: string[]) => void;
  /** Optional metadata-edit callback. When provided, the pencil icon
   *  appears on each thumbnail's hover affordances. */
  onEditMetadata?: (imageId: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onUpload(Array.from(files));
    // Reset so re-selecting the same file fires the change event
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;
    onUpload(files);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = images.findIndex((img) => img.id === active.id);
    const newIndex = images.findIndex((img) => img.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(images, oldIndex, newIndex);
    onReorder(reordered.map((img) => img.id));
  }

  return (
    <div className="sticky top-4 space-y-4">
      <header className="flex items-center justify-between gap-3 pb-4 border-b border-foreground/10">
        <h2 className="text-lg font-semibold tracking-tight">{groupLabel}</h2>
        <span className="text-xs text-muted-foreground tabular-nums px-2 py-1 rounded bg-muted/50">
          {images.length} εικόν{images.length === 1 ? "α" : "ες"}
        </span>
      </header>

      {/* Hidden file input shared by both upload-zone variants. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Layout decision: when nothing is in the group yet (no images
          AND no in-flight uploads), show the LARGE upload zone as the
          empty state. Once any image exists OR an upload is queued,
          flip the order so the grid + in-progress sit at the top and
          a COMPACT upload zone appears below for adding more. */}
      {images.length === 0 && uploading.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed transition-all p-8 text-center ${
            dragActive
              ? "border-foreground bg-foreground/5 scale-[1.01]"
              : "border-foreground/15 hover:border-foreground/40 hover:bg-muted/20"
          }`}
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted/60 mb-3">
            <Upload className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm">
            Σύρετε εικόνες εδώ ή{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="underline font-medium text-foreground hover:text-foreground/80"
            >
              επιλέξτε αρχεία
            </button>
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">
            JPEG, PNG, WebP. Μέχρι 20 MB.
          </p>
          <div className="mt-4 pt-4 border-t border-foreground/10">
            <button
              type="button"
              onClick={onOpenMediaPicker}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              ή επιλογή από βιβλιοθήκη εικόνων
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Image grid — drag-drop reorder via @dnd-kit. Each
              thumbnail's grip handle is the draggable surface;
              clicking elsewhere on the card keeps click-for-lightbox.
              The upload tile is appended as the last cell of the same
              grid so admins see "next image goes here" inline with the
              existing thumbnails. It's OUTSIDE SortableContext so it
              isn't sortable — it sits in the natural grid flow as a
              non-draggable cell. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={images.map((img) => img.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-3 gap-4">
                {images.map((img, idx) => (
                  <ImageThumbnail
                    key={img.id}
                    image={img}
                    onClick={() => onOpenLightbox(idx)}
                    onSetCover={() => onSetCover(img.id)}
                    onDelete={() => onDelete(img.id)}
                    onEditMetadata={
                      onEditMetadata
                        ? () => onEditMetadata(img.id)
                        : undefined
                    }
                  />
                ))}

                {/* Inline upload tile — same aspect-square + rounded-lg
                    + border treatment as ImageThumbnail so it visually
                    reads as "next image goes here" rather than as a
                    separate UI element. Drag-drop fires from the tile
                    itself; click opens the file picker. */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  aria-label="Προσθήκη εικόνας"
                  className={`group aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all ${
                    dragActive
                      ? "border-foreground bg-foreground/5 scale-[1.02]"
                      : "border-foreground/15 hover:border-foreground/40 hover:bg-muted/20"
                  }`}
                >
                  <div
                    className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                      dragActive
                        ? "bg-foreground/10"
                        : "bg-muted/60 group-hover:bg-muted"
                    }`}
                  >
                    <Plus className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">
                    Προσθήκη εικόνας
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    ή σύρετε εδώ
                  </span>
                </button>
              </div>
            </SortableContext>
          </DndContext>

          {/* In-progress uploads — list below the grid so the visual
              flow is: existing images + upload tile (top), things
              currently being processed (middle), library shortcut
              (bottom). */}
          {uploading.length > 0 && (
            <ul className="space-y-1.5">
              {uploading.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/40 border border-foreground/5 text-xs"
                >
                  {u.error ? (
                    <span className="text-destructive flex-1">{u.error}</span>
                  ) : (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      <span className="flex-1 truncate font-medium">
                        {u.filename}
                      </span>
                      <span className="text-muted-foreground">
                        {labelForStage(u.stage)}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Library-picker shortcut — secondary affordance, sits as a
              small inline link below the grid. */}
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={onOpenMediaPicker}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              ή επιλογή από βιβλιοθήκη εικόνων
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function labelForStage(stage: UploadProgressEntry["stage"]): string {
  switch (stage) {
    case "processing":
      return "Επεξεργασία";
    case "uploading":
      return "Μεταφόρτωση";
    case "recording":
      return "Καταχώρηση";
  }
}
