import "server-only";
import { getImageUrl, DEFAULT_PRODUCT_IMAGES_BUCKET } from "@/lib/storage";
import type { ProductImage } from "@/types/products";

/**
 * Ensures a ProductImage row has a populated `url` field for client
 * rendering, deriving it from `storage_key + bucket` via the active
 * StorageProvider when the legacy `url` column is null.
 *
 * Server-only — the resolution chain hits the storage abstraction
 * which imports `server-only`. Pre-resolve at server-component time
 * (or at server-action return time) so client components receive a
 * non-null `url` and don't need to know about the provider.
 *
 * Convention: actions that mutate product_images call this on the
 * returned row before sending it back. Server components that read
 * initial image lists call this in parallel for all images via
 * Promise.all.
 */
export async function resolveProductImageUrl(
  image: ProductImage
): Promise<ProductImage> {
  if (image.url) return image;
  if (image.storage_key) {
    const url = await getImageUrl(
      image.storage_key,
      image.bucket ?? DEFAULT_PRODUCT_IMAGES_BUCKET
    );
    return { ...image, url };
  }
  return image;
}

/**
 * Resolve URLs for an array of ProductImage rows in parallel.
 */
export async function resolveProductImageUrls(
  images: ProductImage[]
): Promise<ProductImage[]> {
  return Promise.all(images.map(resolveProductImageUrl));
}
