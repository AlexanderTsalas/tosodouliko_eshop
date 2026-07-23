import type { Product, ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";

/**
 * The storefront image selection algorithm — bridges the data model
 * (image attribute_combo + product image_axes) to what a customer
 * sees on a PDP for a given variant.
 *
 * Subset-match semantics:
 *   - An image with `attribute_combo = {}` or NULL = general image,
 *     applies to every variant of the product
 *   - An image with `attribute_combo = {color: red-uuid}` applies to
 *     any variant whose attribute_combo includes color=red, regardless
 *     of size or any other axis
 *   - An image with `attribute_combo = {color: red, size: L}` applies
 *     only when both keys match
 *
 * Restriction to image_axes:
 *   The variant's attribute_combo is FIRST restricted to the axes
 *   declared in `products.image_axes`. So when a product has
 *   image_axes=['color'], an image tagged {color: red} matches a
 *   variant with {color: red, size: L} because the size dimension is
 *   IGNORED for image matching.
 *
 * If a product has image_axes=[] (no axes drive imagery — legacy
 * behavior), the variant restriction is empty and only images with
 * empty attribute_combo apply.
 *
 * Sort order (per Decision 8 in docs/product-images-architecture.md):
 *   1. Variant-specific images (non-empty combo) first
 *   2. is_cover descending within each group
 *   3. display_order ascending within each group
 *
 * Performance: O(images × axes) per call. For typical product sizes
 * (5-30 images, 1-3 axes) this is ~30-90 ops per render — cheap. Call
 * sites memoize the result on (variant, images, image_axes).
 */
export function selectImagesForVariant(
  product: Pick<Product, "image_axes">,
  variant: Pick<ProductVariant, "attribute_combo"> | null,
  allImages: ProductImage[]
): ProductImage[] {
  const imageAxes = new Set(product.image_axes ?? []);

  // Restrict the variant's combo to JUST the image-driving axes.
  // If variant is null (no picker engaged), only general images apply.
  const variantImageCombo: Record<string, string> = {};
  if (variant?.attribute_combo) {
    for (const axis of imageAxes) {
      const value = variant.attribute_combo[axis];
      if (value !== undefined) variantImageCombo[axis] = value;
    }
  }

  const matching = allImages.filter((img) =>
    matchesVariant(img, variantImageCombo)
  );

  return matching.sort(compareForDisplay);
}

/**
 * Does this image apply to the (restricted) variant combo?
 *
 *   - General image (empty/null combo): always applies
 *   - Otherwise: every key in the image's combo must appear in the
 *     variant combo with the same value. The image may specify a
 *     subset of the variant's axes (subset-match).
 */
function matchesVariant(
  img: ProductImage,
  variantImageCombo: Record<string, string>
): boolean {
  const imgCombo = img.attribute_combo;
  if (!imgCombo || Object.keys(imgCombo).length === 0) return true;
  for (const [axis, value] of Object.entries(imgCombo)) {
    if (variantImageCombo[axis] !== value) return false;
  }
  return true;
}

function compareForDisplay(a: ProductImage, b: ProductImage): number {
  // Specific (non-empty combo) before general (empty combo)
  const aSpecific =
    a.attribute_combo !== null && Object.keys(a.attribute_combo).length > 0;
  const bSpecific =
    b.attribute_combo !== null && Object.keys(b.attribute_combo).length > 0;
  if (aSpecific !== bSpecific) return aSpecific ? -1 : 1;

  // is_cover before non-cover within each group
  if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;

  // display_order asc within tied groups
  return a.display_order - b.display_order;
}

/**
 * Convenience: pick just the cover image for a variant. Used by
 * catalog cards where we display one image per (product, variant-
 * group). Falls back to first-in-sort if no image is flagged cover.
 */
export function selectCoverImageForVariant(
  product: Pick<Product, "image_axes">,
  variant: Pick<ProductVariant, "attribute_combo"> | null,
  allImages: ProductImage[]
): ProductImage | null {
  const matches = selectImagesForVariant(product, variant, allImages);
  return matches[0] ?? null;
}
