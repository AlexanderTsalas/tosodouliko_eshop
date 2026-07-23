"use client";

import { useMemo, useState, useTransition } from "react";
import ProductImageAxesSelector from "./ProductImageAxesSelector";
import ImageGroupList, {
  comboToKey,
  keyToCombo,
  type ComboKey,
} from "./ImageGroupList";
import ImageEditPane, {
  type UploadProgressEntry,
} from "./ImageEditPane";
import ImageLightbox from "./ImageLightbox";
import ImageMetadataDialog from "./ImageMetadataDialog";
import MediaPickerModal from "./MediaPickerModal";
import {
  uploadProductImage,
  errorMessageEl,
} from "@/lib/media/uploadProductImage";
import {
  uploadProductImageStaged,
} from "@/lib/media/uploadProductImageStaged";
import { setProductImageCover } from "@/actions/product-images/setProductImageCover";
import { deleteProductImageWithCoverPromotion } from "@/actions/product-images/deleteProductImageWithCoverPromotion";
import { reorderProductImagesInGroup } from "@/actions/product-images/reorderProductImagesInGroup";
import { updateProductImage } from "@/actions/product-images/updateProductImage";
import type { ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type {
  Attribute,
  AttributeValue,
} from "@/types/attribute-facets";
import type { StagedImage } from "@/types/staged-image";

interface CommonProps {
  productName: string;
  variants: ProductVariant[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
}

interface EditProps extends CommonProps {
  mode: "edit";
  productId: string;
  initialImageAxes: string[];
  initialImages: ProductImage[];
  /**
   * Optional starting selection — opens the image manager focused on a
   * specific combo group instead of the default "general" group. Used by
   * the product side-panel's variant→image jump: clicking the camera icon
   * on a variant card lands the user with that variant's images already
   * selected. Empty string ("") = general group; otherwise the serialized
   * combo key produced by `comboToKey`.
   */
  initialSelectedKey?: ComboKey;
}

interface CreateProps extends CommonProps {
  mode: "create";
  /** Client-generated UUID used as the storage_key prefix for uploads.
   * Never references a real DB row. createProduct stores the resulting
   * storage_keys verbatim in product_images.storage_key. */
  tempProductId: string;
  /** Currently selected image-axes. Owned by the parent (ProductForm). */
  imageAxes: string[];
  onImageAxesChange: (next: string[]) => void;
  /** Currently staged images. Owned by the parent. */
  stagedImages: StagedImage[];
  onStagedImagesChange: (next: StagedImage[]) => void;
}

type Props = EditProps | CreateProps;

/**
 * Top-level coordinator for the combo-aware Images tab.
 *
 * Two modes, same UI:
 *   - "edit"   — fetches initial state from the server, mutations
 *                call server actions, optimistic UI on top.
 *   - "create" — no DB rows exist yet. State (images + axes) is
 *                controlled by the parent (ProductForm); mutations
 *                just emit onChange callbacks. Uploads go through
 *                the staged orchestrator (storage only, no DB).
 *                On product submit, createProduct inserts the rows.
 *
 * Layout: identical in both modes. The whole point is that the admin
 * sees and interacts with the same UI whether creating a brand new
 * product or editing an existing one.
 */
export default function ProductImagesComboTab(props: Props) {
  const isCreate = props.mode === "create";

  // ───────── State plumbing ─────────────────────────────────────────
  // Edit mode owns images + axes locally. Create mode reads them from
  // props (parent-controlled). The rest of the component is identical.
  const [editImages, setEditImages] = useState<ProductImage[]>(
    isCreate ? [] : (props as EditProps).initialImages
  );
  const [editAxes, setEditAxes] = useState<string[]>(
    isCreate ? [] : (props as EditProps).initialImageAxes
  );

  const images: ProductImage[] = isCreate
    ? (props as CreateProps).stagedImages.map(stagedToProductImage)
    : editImages;
  const selectedAxes = isCreate ? (props as CreateProps).imageAxes : editAxes;

  const setSelectedAxes = (next: string[]) => {
    if (isCreate) (props as CreateProps).onImageAxesChange(next);
    else setEditAxes(next);
  };

  // ───────── UI state ───────────────────────────────────────────────
  // Initial selection — edit mode may receive `initialSelectedKey` from
  // the parent (e.g., side-panel variant→image jump). Defaults to the
  // general group otherwise.
  const initialSelectedKey =
    !isCreate ? (props as EditProps).initialSelectedKey ?? "" : "";
  const [selectedKey, setSelectedKey] = useState<ComboKey>(initialSelectedKey);
  const [uploading, setUploading] = useState<UploadProgressEntry[]>([]);
  const [lightboxStartIndex, setLightboxStartIndex] = useState<number | null>(
    null
  );
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  /** When set, the metadata dialog is open for this image id. */
  const [metadataEditId, setMetadataEditId] = useState<string | null>(null);
  const [_isPending, startTransition] = useTransition();
  void _isPending;

  // Only show the axes actually used by at least one variant.
  const availableAxes = useMemo(() => {
    const knownSlugs = new Set<string>();
    for (const v of props.variants) {
      if (!v.attribute_combo) continue;
      for (const slug of Object.keys(v.attribute_combo)) knownSlugs.add(slug);
    }
    return props.attributes
      .filter((a) => knownSlugs.has(a.slug))
      .map((a) => ({ slug: a.slug, name: a.name }));
  }, [props.variants, props.attributes]);

  // Filter images to the currently-selected group.
  const groupImages = useMemo(() => {
    const targetCombo = keyToCombo(selectedKey);
    const targetIsGeneral = Object.keys(targetCombo).length === 0;
    return images
      .filter((img) => {
        if (targetIsGeneral) {
          return (
            !img.attribute_combo ||
            Object.keys(img.attribute_combo).length === 0
          );
        }
        if (!img.attribute_combo) return false;
        const imgKeys = Object.keys(img.attribute_combo);
        if (imgKeys.length !== Object.keys(targetCombo).length) return false;
        return Object.entries(targetCombo).every(
          ([k, v]) => img.attribute_combo![k] === v
        );
      })
      .sort((a, b) => {
        if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;
        return a.display_order - b.display_order;
      });
  }, [images, selectedKey]);

  const currentGroupLabel = useMemo(() => {
    if (selectedKey === "") return "Κοινές Φωτογραφίες";
    const combo = keyToCombo(selectedKey);
    const labels: string[] = [];
    for (const [axis, valueId] of Object.entries(combo)) {
      const attr = props.attributes.find((a) => a.slug === axis);
      const val = props.attributeValues.find((v) => v.id === valueId);
      labels.push(`${attr?.name ?? axis}: ${val?.value ?? "—"}`);
    }
    return labels.join(" · ");
  }, [selectedKey, props.attributes, props.attributeValues]);

  // ───────── Mutation handlers ──────────────────────────────────────
  function handleUpload(files: File[]) {
    const targetCombo = keyToCombo(selectedKey);

    for (const file of files) {
      const localId = crypto.randomUUID();
      setUploading((prev) => [
        ...prev,
        { id: localId, filename: file.name, stage: "processing" },
      ]);

      startTransition(async () => {
        if (isCreate) {
          // Create mode: staged orchestrator (storage only, no DB).
          const cProps = props as CreateProps;
          const result = await uploadProductImageStaged({
            file,
            tempProductId: cProps.tempProductId,
            onProgress: (stage) => {
              setUploading((prev) =>
                prev.map((u) =>
                  u.id === localId
                    ? { ...u, stage: stage as UploadProgressEntry["stage"] }
                    : u
                )
              );
            },
          });

          if (result.ok) {
            // Append to staged list. Cover = true if this is the first
            // image in its (attribute_combo) group; cover stays where
            // it already is otherwise. display_order = current group
            // count.
            const groupCount = cProps.stagedImages.filter((s) =>
              isSameCombo(s.attributeCombo, targetCombo)
            ).length;
            const groupHasCover = cProps.stagedImages.some(
              (s) =>
                isSameCombo(s.attributeCombo, targetCombo) && s.isCover
            );
            const next: StagedImage = {
              localId,
              storageKey: result.data.storageKey,
              bucket: result.data.bucket,
              sizeBytes: result.data.sizeBytes,
              blobUrl: URL.createObjectURL(result.data.blob),
              attributeCombo: targetCombo,
              altText: null,
              isCover: !groupHasCover && groupCount === 0,
              displayOrder: groupCount,
            };
            cProps.onStagedImagesChange([...cProps.stagedImages, next]);
            setUploading((prev) => prev.filter((u) => u.id !== localId));
          } else {
            setUploading((prev) =>
              prev.map((u) =>
                u.id === localId
                  ? { ...u, error: errorMessageEl(result.error) }
                  : u
              )
            );
            setTimeout(() => {
              setUploading((prev) => prev.filter((u) => u.id !== localId));
            }, 6000);
          }
          return;
        }

        // Edit mode — original flow.
        const result = await uploadProductImage({
          file,
          productId: (props as EditProps).productId,
          attributeCombo: targetCombo,
          onProgress: (stage) => {
            setUploading((prev) =>
              prev.map((u) =>
                u.id === localId
                  ? { ...u, stage: stage as UploadProgressEntry["stage"] }
                  : u
              )
            );
          },
        });

        if (result.ok) {
          setEditImages((prev) => [...prev, result.data.productImage]);
          setUploading((prev) => prev.filter((u) => u.id !== localId));
        } else {
          setUploading((prev) =>
            prev.map((u) =>
              u.id === localId
                ? { ...u, error: errorMessageEl(result.error) }
                : u
            )
          );
          setTimeout(() => {
            setUploading((prev) => prev.filter((u) => u.id !== localId));
          }, 6000);
        }
      });
    }
  }

  function handleSetCover(imageId: string) {
    if (isCreate) {
      const cProps = props as CreateProps;
      const target = cProps.stagedImages.find((s) => s.localId === imageId);
      if (!target) return;
      cProps.onStagedImagesChange(
        cProps.stagedImages.map((s) => {
          if (s.localId === imageId) return { ...s, isCover: true };
          if (isSameCombo(s.attributeCombo, target.attributeCombo)) {
            return { ...s, isCover: false };
          }
          return s;
        })
      );
      return;
    }

    // Edit mode
    setEditImages((prev) => {
      const target = prev.find((i) => i.id === imageId);
      if (!target) return prev;
      const targetComboKey = comboToKey(target.attribute_combo);
      return prev.map((i) => {
        if (i.id === imageId) return { ...i, is_cover: true };
        if (comboToKey(i.attribute_combo) === targetComboKey) {
          return { ...i, is_cover: false };
        }
        return i;
      });
    });

    startTransition(async () => {
      const r = await setProductImageCover({ imageId });
      if (!r.success) {
        setEditImages((props as EditProps).initialImages);
      }
    });
  }

  function handleDelete(imageId: string) {
    if (isCreate) {
      const cProps = props as CreateProps;
      const target = cProps.stagedImages.find((s) => s.localId === imageId);
      if (!target) return;
      // Revoke the blob URL to free the in-memory image.
      try {
        URL.revokeObjectURL(target.blobUrl);
      } catch {
        // ignore — revoke is best-effort
      }
      const remaining = cProps.stagedImages.filter(
        (s) => s.localId !== imageId
      );
      // If we removed the cover, promote the lowest-display_order
      // sibling in the same group.
      if (target.isCover) {
        const sameGroup = remaining
          .filter((s) =>
            isSameCombo(s.attributeCombo, target.attributeCombo)
          )
          .sort((a, b) => a.displayOrder - b.displayOrder);
        const newCover = sameGroup[0]?.localId;
        if (newCover) {
          cProps.onStagedImagesChange(
            remaining.map((s) =>
              s.localId === newCover ? { ...s, isCover: true } : s
            )
          );
          return;
        }
      }
      cProps.onStagedImagesChange(remaining);
      return;
    }

    // Edit mode
    const target = editImages.find((i) => i.id === imageId);
    if (!target) return;
    const isCoverWas = target.is_cover;
    const targetComboKey = comboToKey(target.attribute_combo);

    setEditImages((prev) => {
      const remaining = prev.filter((i) => i.id !== imageId);
      if (!isCoverWas) return remaining;
      let promoted = false;
      return remaining
        .sort((a, b) => a.display_order - b.display_order)
        .map((i) => {
          if (
            !promoted &&
            comboToKey(i.attribute_combo) === targetComboKey
          ) {
            promoted = true;
            return { ...i, is_cover: true };
          }
          return i;
        });
    });

    startTransition(async () => {
      const r = await deleteProductImageWithCoverPromotion({ imageId });
      if (!r.success) {
        setEditImages((props as EditProps).initialImages);
      }
    });
  }

  function handleReorder(imageIdsInOrder: string[]) {
    const targetCombo = keyToCombo(selectedKey);

    if (isCreate) {
      const cProps = props as CreateProps;
      const groupOrderById = new Map(
        imageIdsInOrder.map((id, idx) => [id, idx])
      );
      cProps.onStagedImagesChange(
        cProps.stagedImages.map((s) => {
          if (!isSameCombo(s.attributeCombo, targetCombo)) return s;
          const newOrder = groupOrderById.get(s.localId);
          if (newOrder === undefined) return s;
          return { ...s, displayOrder: newOrder };
        })
      );
      return;
    }

    // Edit mode
    const targetComboKey = comboToKey(
      Object.keys(targetCombo).length === 0 ? null : targetCombo
    );
    const groupOrderById = new Map(
      imageIdsInOrder.map((id, idx) => [id, idx])
    );

    setEditImages((prev) =>
      prev.map((img) => {
        if (comboToKey(img.attribute_combo) !== targetComboKey) return img;
        const newOrder = groupOrderById.get(img.id);
        if (newOrder === undefined) return img;
        return { ...img, display_order: newOrder };
      })
    );

    startTransition(async () => {
      const r = await reorderProductImagesInGroup({
        productId: (props as EditProps).productId,
        attributeCombo: targetCombo,
        imageIdsInOrder,
      });
      if (!r.success) {
        setEditImages((props as EditProps).initialImages);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[320px_1fr] gap-5 items-start">
        <aside className="space-y-4">
          <div className="rounded-lg border border-foreground/10 bg-card shadow-sm overflow-hidden">
            <ProductImageAxesSelector
              mode={isCreate ? "create" : "edit"}
              productId={isCreate ? null : (props as EditProps).productId}
              initialAxes={selectedAxes}
              availableAxes={availableAxes}
              imageCount={images.length}
              onChange={setSelectedAxes}
            />
          </div>
          <div className="rounded-lg border border-foreground/10 bg-card shadow-sm overflow-hidden">
            <ImageGroupList
              selectedAxes={selectedAxes}
              selectedKey={selectedKey}
              images={images}
              variants={props.variants}
              attributes={props.attributes}
              attributeValues={props.attributeValues}
              onSelect={setSelectedKey}
            />
          </div>
        </aside>

        <main className="rounded-lg border border-foreground/10 bg-card shadow-sm p-5">
          <ImageEditPane
            groupLabel={currentGroupLabel}
            images={groupImages}
            uploading={uploading}
            onUpload={handleUpload}
            onOpenLightbox={setLightboxStartIndex}
            onSetCover={handleSetCover}
            onDelete={handleDelete}
            onOpenMediaPicker={() => setMediaPickerOpen(true)}
            onReorder={handleReorder}
            onEditMetadata={(imageId) => setMetadataEditId(imageId)}
          />
        </main>
      </div>

      {lightboxStartIndex !== null && (
        <ImageLightbox
          images={groupImages}
          startIndex={lightboxStartIndex}
          onClose={() => setLightboxStartIndex(null)}
        />
      )}

      {/* Media library picker — only meaningful in edit mode (it
          inserts product_images rows server-side). Create mode hides
          it; admins can still add from library after saving. */}
      {!isCreate && (
        <MediaPickerModal
          open={mediaPickerOpen}
          productId={(props as EditProps).productId}
          attributeCombo={keyToCombo(selectedKey)}
          onClose={() => setMediaPickerOpen(false)}
          onPicked={(addedRows) => {
            setEditImages((prev) => [...prev, ...addedRows]);
            setMediaPickerOpen(false);
          }}
        />
      )}

      {/* Per-image metadata editor — surfaces updateProductImage's
          alt-text + attribute-combo reassignment through the UI for
          the first time. Two modes:
          - edit: calls the server action, optimistically updates local
            state, reverts on failure.
          - create: patches the staged image in place. */}
      {metadataEditId !== null &&
        (() => {
          const target = images.find((i) => i.id === metadataEditId);
          if (!target) return null;
          return (
            <ImageMetadataDialog
              image={target}
              availableAxes={availableAxes}
              attributeValues={props.attributeValues}
              attributes={props.attributes}
              onClose={() => setMetadataEditId(null)}
              onSubmit={async (patch) => {
                if (isCreate) {
                  // Patch the staged image in place.
                  const cProps = props as CreateProps;
                  cProps.onStagedImagesChange(
                    cProps.stagedImages.map((s) =>
                      s.localId === metadataEditId
                        ? {
                            ...s,
                            altText:
                              patch.altText === undefined
                                ? s.altText
                                : patch.altText,
                            attributeCombo:
                              patch.attributeCombo === undefined
                                ? s.attributeCombo
                                : patch.attributeCombo,
                          }
                        : s
                    )
                  );
                  return;
                }
                // Edit mode — server action + optimistic update.
                const prev = editImages;
                setEditImages((curr) =>
                  curr.map((i) =>
                    i.id === metadataEditId
                      ? {
                          ...i,
                          alt_text:
                            patch.altText === undefined
                              ? i.alt_text
                              : patch.altText,
                          alt_text_is_auto:
                            patch.altText === null
                              ? true
                              : patch.altText === undefined
                                ? i.alt_text_is_auto
                                : false,
                          attribute_combo:
                            patch.attributeCombo === undefined
                              ? i.attribute_combo
                              : Object.keys(patch.attributeCombo).length === 0
                                ? null
                                : patch.attributeCombo,
                        }
                      : i
                  )
                );
                const r = await updateProductImage({
                  imageId: metadataEditId,
                  // null means "reset to auto-generated". Server
                  // schema accepts string | null | undefined.
                  ...(patch.altText !== undefined
                    ? { altText: patch.altText }
                    : {}),
                  ...(patch.attributeCombo !== undefined
                    ? { attributeCombo: patch.attributeCombo }
                    : {}),
                });
                if (!r.success) {
                  setEditImages(prev);
                  throw new Error(r.error);
                }
              }}
            />
          );
        })()}

      <p className="text-xs text-muted-foreground italic">
        Όνομα προϊόντος: {props.productName}
      </p>
    </div>
  );
}

// ───────── Helpers ──────────────────────────────────────────────────

function isSameCombo(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/**
 * Map a StagedImage to a synthetic ProductImage so the existing
 * UI components (ImageGroupList, ImageEditPane, ImageThumbnail)
 * don't need to know about the staged shape.
 */
function stagedToProductImage(s: StagedImage): ProductImage {
  return {
    id: s.localId,
    product_id: "", // placeholder; not read by the UI
    attribute_combo:
      Object.keys(s.attributeCombo).length === 0 ? null : s.attributeCombo,
    media_asset_id: null,
    url: s.blobUrl,
    storage_key: s.storageKey,
    bucket: s.bucket,
    alt_text: s.altText,
    alt_text_is_auto: s.altText === null,
    display_order: s.displayOrder,
    is_cover: s.isCover,
    created_at: "",
  };
}
