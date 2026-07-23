/**
 * Types for the media library picker — kept in a separate file (not
 * inside the "use server" action module) because Next.js 15+ rejects
 * non-async-function exports from server-action modules. Interfaces
 * are type-only and erased at compile, but the bundler check happens
 * at the source level.
 */
import type { MediaAsset } from "./media-library";

export interface MediaAssetForPicker extends MediaAsset {
  /** Resolved public URL — derived from bucket + storage_key via the
   * active StorageProvider. */
  url: string;
}

export interface MediaPickerPage {
  items: MediaAssetForPicker[];
  total: number;
  /** True if (offset + pageSize) < total — more pages available. */
  hasMore: boolean;
}
