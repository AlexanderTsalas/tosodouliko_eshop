/**
 * Type for an image that's been uploaded to storage but doesn't yet
 * have a product_images row — used during product creation when the
 * product itself hasn't been inserted yet.
 *
 * Shape is designed to:
 *   1. Carry everything `createProduct` needs to insert the
 *      media_assets + product_images rows on submit
 *   2. Map cheaply to a synthetic ProductImage for UI rendering (the
 *      existing ImageThumbnail, ImageEditPane, etc. don't need to
 *      know about staging)
 */
export interface StagedImage {
  /** Synthetic uniqueness key. Used by React keys + dnd-kit sortable. */
  localId: string;
  /** Path in storage where the bytes already live (uploaded via the
   * presigned-URL flow with tempProductId as the prefix). */
  storageKey: string;
  /** Bucket name — matches the active StorageProvider's default. */
  bucket: string;
  /** Byte size of the processed WebP. Lands in media_assets.size_bytes
   * after product creation. */
  sizeBytes: number;
  /** Object URL for the in-memory blob. Used by <img src={blobUrl}/>
   * so the admin sees the thumbnail without a network round-trip.
   * Caller MUST revoke this when removing the staged image
   * (URL.revokeObjectURL). */
  blobUrl: string;
  /** Subset of axis values this image applies to. Empty object means
   * "general" (applies to all variants). */
  attributeCombo: Record<string, string>;
  /** Manual alt-text override; null = will be auto-generated server-side. */
  altText: string | null;
  /** Cover for this image's (product, attribute_combo) group. */
  isCover: boolean;
  /** Position within the group. */
  displayOrder: number;
}
