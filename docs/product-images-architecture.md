# Product Images — Architecture & Implementation Plan

**Date:** 2026-06-11
**Status:** Spec locked, ready for implementation
**Companion to:** [src/lib/storage/README.md](../src/lib/storage/README.md) (storage abstraction)

This document specifies the complete product image system: data model, upload flow, admin UI, storefront integration, background jobs, and migration strategy. Every decision has been worked through with rationale; this is the build spec.

---

## Background

Product images on an e-commerce site serve two coupled but distinct functions:

1. **Identifying which variant a customer is looking at.** When a customer picks "red" in the variant selector, imagery swaps to show red. Not every attribute drives imagery (size doesn't), so the model needs to express "which attributes affect imagery for this product."

2. **Stocking the catalog + PDP visual content.** Hero, gallery thumbnails, lifestyle shots, size charts. Multiple images per variant, ordered, with one cover.

The system already has a sound foundation:
- `media_assets` table with provider-agnostic bucket+key shape
- `attributes.splits_listing` + `products.split_overrides` already control which axes split catalog cards
- The `StorageProvider` abstraction (just landed) decouples storage backend from code

What's missing is the **per-product expression of "which axes drive imagery,"** the **subset-match association between images and attribute combos**, and the **admin UI to manage it all coherently**.

---

## The 15 architectural decisions

For reference. Detailed rationale lives in the conversation history; this summarizes what we landed on.

### Data model decisions (1-8)

| # | Topic | Decision |
|---|---|---|
| 1 | Catalog cover | None separate — covers are per attribute-combo group; catalog cards already split per image-axis via `splits_listing` |
| 2 | Data structure | `product_images.attribute_combo jsonb` storing the subset of axis values that determines when this image displays |
| 3 | Delete from variant | DELETE `product_images` row only; `media_assets` row + storage bytes stay (image remains in media library) |
| 4 | Image reuse | Multiple `product_images` rows can point at one `media_assets` row (same file used across products) |
| 5 | Alt text | Auto-generated at upload from product name + combo value labels; `alt_text_is_auto` flag enables selective regeneration; admin can override |
| 6 | Image-axes change | Non-destructive: existing images keep their `attribute_combo`; UI surfaces an informational notice |
| 7 | Multi-select bulk | Phase 2+; MVP has "General / All variants" entry at the top of the left list (= `attribute_combo` empty) |
| 8 | Carousel order | Variant-specific first, general after; `display_order` within each group |

### Upload flow decisions (9-15)

| # | Topic | Decision |
|---|---|---|
| 9 | Upload mechanism | Browser-direct via presigned URL; 20MB hard cap via signed URL `maxBytes` |
| 10 | Client processing | Web Worker: convert to WebP q85 (re-encoding strips EXIF automatically); downscale only if longest dimension > 4000px |
| 11 | Orphan handling | Nightly cron reaper, 24-hour orphan window |
| 12 | Validation | Defense in depth: file picker `accept` → client MIME → client magic-byte → server input zod → signed-URL maxBytes → **server-side magic-byte verify after upload (reject non-WebP)** |
| 12+ | Server fallback | Reject by default; opt-in via `SERVER_SIDE_FORMAT_FALLBACK=true` env to enable sharp-based conversion fallback |
| 13 | Media library reuse | Multi-select picker extracted from existing `/admin/media` grid |
| 14 | Reorder UX | `@dnd-kit/sortable` with optimistic UI; server persists `display_order` |
| 15 | Cover toggle | Star icon top-right of each thumbnail; server enforces single-cover-per-combo atomically via SQL transaction |

### User-facing strings

- Server-side magic-byte rejection error message (Greek):
  > "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά"

---

## Complete data model

### Schema additions

```sql
-- ──── products: declare which axes drive imagery ──────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_axes text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.products.image_axes IS
'Attribute slugs that drive image selection on this product. e.g. [''color''] means picker color-change swaps images; size-change does not. Storefront filters product_images by matching attribute_combo subset against the customer''s currently-selected attribute_combo restricted to these axes.';

-- ──── product_images: subset-match association ───────────────────────────
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS attribute_combo  jsonb,
  ADD COLUMN IF NOT EXISTS media_asset_id   uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_cover         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alt_text_is_auto boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.product_images.attribute_combo IS
'Subset of attribute-axis values that determine when this image shows. {} (or NULL) = general image (always applies). {color: red-uuid} = applies to any variant whose attribute_combo includes color=red, regardless of other axes. {color: red-uuid, size: L-uuid} = applies only to that specific combination. Storefront subset-matches against the customer''s currently-selected variant attribute_combo restricted to products.image_axes.';

COMMENT ON COLUMN public.product_images.media_asset_id IS
'FK to media_assets — the file. Multiple product_images rows can reference the same media_asset (image reuse across products / attribute-combos). NULL only for legacy rows where storage_key was populated directly without going through media library.';

COMMENT ON COLUMN public.product_images.is_cover IS
'Marks this image as the cover for its attribute_combo group within this product. Enforced single-cover-per-(product, attribute_combo) via the server action transaction (no DB constraint because attribute_combo is a jsonb, expensive to constrain).';

COMMENT ON COLUMN public.product_images.alt_text_is_auto IS
'TRUE means alt_text was auto-generated and should be regenerated when the underlying product name or attribute values change. FALSE means admin manually overrode the alt text — preserve as-is.';

-- ──── Index supporting the subset-match query at render ──────────────────
CREATE INDEX IF NOT EXISTS idx_product_images_combo_gin
  ON public.product_images USING gin (attribute_combo);

-- ──── Index for finding images by media_asset (reuse, deletion checks) ───
CREATE INDEX IF NOT EXISTS idx_product_images_media_asset
  ON public.product_images(media_asset_id)
  WHERE media_asset_id IS NOT NULL;
```

### Schema interpretation

After this migration, a row in `product_images` carries:

| Column | Meaning |
|---|---|
| `id` | PK |
| `product_id` | FK to products |
| `media_asset_id` | FK to the file in `media_assets` (new — preferred path) |
| `storage_key` | Legacy direct key (existed from prior storage-abstraction work) |
| `bucket` | Legacy direct bucket (existed from prior work) |
| `url` | Legacy direct URL (predates the abstraction; nullable post-migration) |
| `attribute_combo` | Subset of axes this image applies to. `{}` or NULL = general |
| `is_cover` | Cover for its attribute_combo group |
| `display_order` | Sort within group |
| `alt_text` | Override; otherwise resolved from media_assets.alt_text or auto-generated |
| `alt_text_is_auto` | Whether alt_text is admin-edited |
| `variant_id` | Legacy FK to a specific variant (pre-attribute_combo model; transition window only) |

The `url` and `variant_id` columns are **deprecated but kept during transition** so reads keep working. After all callers have migrated to the new model, a future migration drops them.

### Backfill strategy

```sql
-- Step 1: backfill attribute_combo from existing variant_id rows.
-- An image tied to "the red size-12 variant" gets the full variant
-- attribute_combo. After this, the new subset-match algorithm produces
-- identical results to the old variant_id direct match.
UPDATE public.product_images pi
SET attribute_combo = v.attribute_combo
FROM public.product_variants v
WHERE pi.variant_id = v.id
  AND pi.attribute_combo IS NULL;

-- Step 2: backfill media_asset_id for rows whose storage_key matches an
-- existing media_assets row. (Should be ~most rows; some legacy URL-only
-- rows stay with media_asset_id = NULL.)
UPDATE public.product_images pi
SET media_asset_id = ma.id
FROM public.media_assets ma
WHERE pi.media_asset_id IS NULL
  AND pi.storage_key IS NOT NULL
  AND ma.bucket = pi.bucket
  AND ma.storage_key = pi.storage_key;

-- Step 3: backfill is_cover from legacy is_primary (the existing column
-- representing "main image for the product"). Each product's primary
-- becomes the cover of its attribute_combo group.
UPDATE public.product_images
SET is_cover = true
WHERE is_primary = true;
```

---

## Image selection algorithm

The storefront's PDP renders the carousel by computing which images apply to the currently-selected variant.

```ts
function selectImagesForVariant(
  product: Product,
  selectedVariant: ProductVariant,
  allImages: ProductImage[]
): ProductImage[] {
  const imageAxes = new Set(product.image_axes);
  // Restrict the variant's combo to just the image-axes
  const variantImageCombo = pickKeys(
    selectedVariant.attribute_combo ?? {},
    imageAxes
  );

  const matching = allImages.filter((img) => {
    const imgCombo = img.attribute_combo ?? {};
    // Empty combo = general image, always applies
    if (Object.keys(imgCombo).length === 0) return true;
    // Image's combo must be a subset of the variant's image-axis values
    return Object.entries(imgCombo).every(
      ([axis, value]) => variantImageCombo[axis] === value
    );
  });

  // Sort: variant-specific (cover first, then display_order),
  // then general (cover first, then display_order)
  return matching.sort((a, b) => {
    const aSpecific = Object.keys(a.attribute_combo ?? {}).length > 0;
    const bSpecific = Object.keys(b.attribute_combo ?? {}).length > 0;
    if (aSpecific !== bSpecific) return aSpecific ? -1 : 1;
    if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;
    return a.display_order - b.display_order;
  });
}
```

### Catalog card image selection

Catalog cards already represent specific (product × splitting-attribute-values) combinations via `searchVariants`. Each card's image is the cover of the `product_images` rows matching that card's combo.

The existing `searchVariants` function already constructs a per-card image; the migration is to make its image-selection logic call the algorithm above against `product_images.attribute_combo` instead of `variant_id`.

---

## Server actions

The complete API surface for product image management. Six actions total.

### 1. `requestProductImageUpload`

Returns a presigned URL for browser-direct upload.

```ts
"use server";

export async function requestProductImageUpload(input: {
  productId: string;
  filename: string;
  contentType: string;
  attributeCombo: Record<string, string>;
}): Promise<Result<{
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  storageKey: string;
  bucket: string;
}>> {
  // 1. Permission check (manage:products)
  // 2. Validate contentType is in whitelist (image/webp ONLY for new uploads;
  //    legacy admins might upload JPEG which the client converts)
  // 3. Generate storage_key: `${productId}/${randomUUID()}.webp`
  // 4. Call provider.signedUploadUrl({
  //      bucket: "product-images",
  //      key,
  //      contentType,
  //      ttlSeconds: 300,
  //      maxBytes: 20 * 1024 * 1024,
  //    })
  // 5. Return URL + key + bucket
}
```

### 2. `recordProductImage`

After the browser uploads bytes via the presigned URL, this action verifies the upload and creates DB rows.

```ts
"use server";

export async function recordProductImage(input: {
  productId: string;
  storageKey: string;
  bucket: string;
  contentType: string;
  attributeCombo: Record<string, string>;
}): Promise<Result<ProductImage>> {
  // 1. Permission check
  // 2. provider.exists() — confirm file arrived
  // 3. Read first 16 bytes via HTTP Range header (cheap)
  // 4. Verify WebP magic-byte signature ("RIFF" at 0-3, "WEBP" at 8-11)
  //    - On mismatch: provider.delete() + return error code NOT_WEBP
  //    - Greek user-facing message handled at client
  // 5. Generate alt_text from product.name + attribute_combo value labels
  // 6. Transaction:
  //    a. INSERT media_assets row (uploader_id, bucket, storage_key, ...)
  //    b. INSERT product_images row with attribute_combo, media_asset_id,
  //       is_cover = (this is the first image for this combo group)
  // 7. Cache invalidations:
  //    - revalidatePath(`/admin/products/${productId}/edit`)
  //    - revalidatePath(`/products/${productSlug}`)
  //    - revalidateTag("catalog-facets")
}
```

### Optional fallback path

When `SERVER_SIDE_FORMAT_FALLBACK=true`, step 4 above changes:
- If magic-byte mismatch:
  - Download the file from storage
  - `import("sharp")` → convert to WebP
  - `provider.put()` overwrite the original
  - Proceed with insert

### 3. `setProductImageCover`

Marks one image as cover for its attribute_combo group; atomically unsets cover on others in the same group.

```ts
"use server";

export async function setProductImageCover(input: {
  imageId: string;
}): Promise<Result<null>> {
  // 1. Permission check
  // 2. Load image to get product_id + attribute_combo
  // 3. Transaction:
  //    a. UPDATE product_images SET is_cover = false
  //       WHERE product_id = $1 AND attribute_combo = $2 (jsonb equal)
  //    b. UPDATE product_images SET is_cover = true WHERE id = $3
  // 4. Cache invalidations
}
```

### 4. `updateProductImage`

Edit metadata: alt_text, display_order, attribute_combo.

```ts
"use server";

export async function updateProductImage(input: {
  imageId: string;
  altText?: string;
  displayOrder?: number;
  attributeCombo?: Record<string, string>;
}): Promise<Result<ProductImage>> {
  // 1. Permission check
  // 2. If altText provided: also set alt_text_is_auto = false
  // 3. UPDATE the row
  // 4. Cache invalidations
}
```

### 5. `reorderProductImages`

Persists drag-and-drop reordering. Accepts a list of image IDs in their new order.

```ts
"use server";

export async function reorderProductImages(input: {
  productId: string;
  attributeCombo: Record<string, string>;
  imageIdsInOrder: string[];
}): Promise<Result<null>> {
  // 1. Permission check
  // 2. Verify all imageIds belong to this product + combo
  // 3. Bulk UPDATE: display_order = array index for each image
  //    (Single SQL: UPDATE ... FROM (VALUES (id, idx), ...) AS v(id, idx) ...)
  // 4. Cache invalidations
}
```

### 6. `deleteProductImage`

Removes the `product_images` row. The `media_assets` row + storage bytes stay (image stays in media library).

```ts
"use server";

export async function deleteProductImage(input: {
  imageId: string;
}): Promise<Result<null>> {
  // 1. Permission check
  // 2. Load image to determine if it was the cover (we may need to promote
  //    another image in the same combo group to be the new cover)
  // 3. DELETE product_images row
  // 4. If was cover: pick the next image (lowest display_order) in same
  //    combo group and set is_cover = true on it. If no other images in
  //    the group: skip.
  // 5. Cache invalidations
  // 6. NOTE: media_assets row stays. Orphan reaper handles eventual
  //    cleanup IF the media_asset isn't referenced by other product_images
  //    rows for ≥ 24h.
}
```

### 7. `setProductImageAxes`

Admin sets which axes drive imagery for this product.

```ts
"use server";

export async function setProductImageAxes(input: {
  productId: string;
  imageAxes: string[];
}): Promise<Result<null>> {
  // 1. Permission check
  // 2. Validate every axis is in this product's attributes
  // 3. UPDATE products SET image_axes = $1
  // 4. NOTE: existing product_images keep their attribute_combo unchanged.
  //    UI surfaces an informational notice that re-tagging may be desired.
  // 5. Cache invalidations
}
```

### 8. `linkMediaAssetsToProduct`

Used by the media library picker — links existing media_assets to a product as new product_images rows.

```ts
"use server";

export async function linkMediaAssetsToProduct(input: {
  productId: string;
  attributeCombo: Record<string, string>;
  mediaAssetIds: string[];
}): Promise<Result<ProductImage[]>> {
  // 1. Permission check
  // 2. For each media_asset_id:
  //    a. Load the media_assets row (verify exists + accessible)
  //    b. Generate alt_text from product name + combo labels
  //    c. INSERT product_images row with media_asset_id, attribute_combo,
  //       display_order (continues from max existing in this combo)
  //    d. First image in combo gets is_cover = true
  // 3. Bulk insert in a single transaction
  // 4. Cache invalidations
  // 5. Return all created rows
}
```

---

## Client-side image processing

### The Web Worker

```ts
// src/lib/media/imageProcessor.worker.ts
import imageCompression from "browser-image-compression";

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    // 1. Magic-byte verification on the raw file
    const firstBytes = new Uint8Array(
      await event.data.file.slice(0, 16).arrayBuffer()
    );
    if (!isValidImageMagic(firstBytes)) {
      self.postMessage({ error: "INVALID_FORMAT" });
      return;
    }

    // 2. Convert to WebP, downscale only if > 4000px
    const processed = await imageCompression(event.data.file, {
      maxWidthOrHeight: 4000,
      fileType: "image/webp",
      initialQuality: 0.85,
      useWebWorker: false, // already in a worker
    });

    self.postMessage({ blob: processed });
  } catch (err) {
    self.postMessage({ error: "PROCESSING_FAILED" });
  }
};

function isValidImageMagic(bytes: Uint8Array): boolean {
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // WebP: RIFF????WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  // GIF (admin might upload, also convertible): 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  return false;
}
```

### The upload orchestrator (client-side)

```ts
// src/lib/media/uploadProductImage.ts
import { requestProductImageUpload, recordProductImage } from "@/actions/...";

export async function uploadProductImage(input: {
  file: File;
  productId: string;
  attributeCombo: Record<string, string>;
  onProgress?: (stage: "processing" | "uploading" | "recording") => void;
}): Promise<ProductImage> {
  // 1. Process via Web Worker
  input.onProgress?.("processing");
  const processed = await processInWorker(input.file);

  // 2. Request presigned URL
  input.onProgress?.("uploading");
  const upload = await requestProductImageUpload({
    productId: input.productId,
    filename: input.file.name,
    contentType: "image/webp",
    attributeCombo: input.attributeCombo,
  });
  if (!upload.success) throw new Error(upload.error);

  // 3. Browser-direct PUT
  const putRes = await fetch(upload.data.uploadUrl, {
    method: upload.data.method,
    headers: upload.data.headers,
    body: processed,
  });
  if (!putRes.ok) throw new Error("UPLOAD_FAILED");

  // 4. Record in DB
  input.onProgress?.("recording");
  const record = await recordProductImage({
    productId: input.productId,
    storageKey: upload.data.storageKey,
    bucket: upload.data.bucket,
    contentType: "image/webp",
    attributeCombo: input.attributeCombo,
  });
  if (!record.success) throw new Error(record.error);

  return record.data;
}
```

---

## Admin UI — the Images tab

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ TABS:  Επισκόπηση  |  Παραλλαγές  |  Εικόνες  ← active            │
├──────────────────────────────────────────────────────────────────┤
│ Image-axis selector (top of page):                                │
│   ☐ Color       ☐ Size       ☐ Material                          │
│   ("Επιλέξτε άξονες που επηρεάζουν την εικόνα")                  │
├────────────────────┬─────────────────────────────────────────────┤
│ LEFT (scrollable)  │ RIGHT (sticky)                              │
│                    │                                              │
│ ▸ General          │ Selected: Red                                │
│ ▸ Red       (3)    │                                              │
│ ▸ Blue      (2)    │ ┌──────┐ ┌──────┐ ┌──────┐                  │
│ ▸ Green     (0)    │ │ ★⛔  │ │  ⛔  │ │  ⛔  │                  │
│ ▸ Black     (3)    │ │ img1 │ │ img2 │ │ img3 │                  │
│                    │ └──────┘ └──────┘ └──────┘                  │
│                    │                                              │
│                    │ [Upload new image]  [Select from library]    │
│                    │                                              │
└────────────────────┴─────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| `ProductImageAxesSelector` | Multi-checkbox of attributes; calls `setProductImageAxes` on change; shows notice "Existing X images will keep their tags" when changed |
| `ProductImagesTab` | Top-level page component; coordinates state between axes selector, list, pane |
| `ImageGroupList` | Left list — entries are: "General" + one per distinct attribute-combo derived from image_axes |
| `ImageEditPane` | Right pane — sticky; shows images for the selected group; upload affordances + reorder + cover |
| `ImageThumbnail` | Single image with cover toggle, delete button, drag handle, click-for-lightbox |
| `ImageLightbox` | Full-screen modal with arrow navigation |
| `MediaPickerModal` | Modal for picking from existing media library; multi-select |

### State management

The page is state-heavy but mostly local:

```ts
const [selectedAxes, setSelectedAxes] = useState<string[]>(product.image_axes);
const [selectedCombo, setSelectedCombo] = useState<Record<string, string>>({});
const [images, setImages] = useState<ProductImage[]>(initialImages);
const [uploadingFiles, setUploadingFiles] = useState<UploadProgress[]>([]);
```

Server-action results update local state optimistically; failures revert.

### Upload affordance

Drag-and-drop zone in the right pane. Multi-file drop. Each file independently:
- Adds an `UploadProgress` entry to local state (showing a placeholder with progress)
- Runs through `uploadProductImage(...)` in parallel (up to 4 concurrent — Web Worker can only process one at a time, but uploads can be parallel)
- On completion, the placeholder is replaced with the real thumbnail
- On failure, the placeholder shows the error and a retry button

### Media library picker

The existing `/admin/media` page already has a grid. Extract into a `MediaPickerModal`:
- Same grid + filters
- Multi-select via checkboxes on each thumbnail
- "Use these" button calls `linkMediaAssetsToProduct(...)`

---

## Storefront integration

### PDP — variant picker drives image swap

```tsx
// src/components/features/products/ProductDetailInteractive.tsx
const allImages: ProductImage[] = ...; // fetched at page level

function ProductDetail({ product, variants, allImages }: Props) {
  const [selectedVariant, setSelectedVariant] = useState(variants[0]);

  const displayedImages = useMemo(
    () => selectImagesForVariant(product, selectedVariant, allImages),
    [product, selectedVariant, allImages]
  );

  return (
    <>
      <ImageCarousel images={displayedImages} />
      <VariantPicker
        variants={variants}
        selected={selectedVariant}
        onChange={setSelectedVariant}
      />
    </>
  );
}
```

When `selectedVariant` changes:
- `displayedImages` recomputes (subset-match)
- Carousel re-renders with new images
- A nice transition: fade out old, fade in new (handled in the carousel component)

### Catalog cards

The existing `searchVariants` builds cards. Each card already has a representative `attribute_combo`. The migration is to make its image selection use:

```ts
// In searchVariants, for each card:
const cardImages = selectImagesForCardCombo(product, card.attribute_combo, productImages);
const coverImage = cardImages.find((img) => img.is_cover) ?? cardImages[0];
card.image = coverImage;
```

---

## Carousel + lightbox

### `ImageCarousel`

Main hero with arrow navigation + indicator bullets. Tap/click image opens lightbox.

```tsx
function ImageCarousel({ images }: { images: ProductImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Reset to first image when the image set changes (variant picker swap)
  useEffect(() => setActiveIndex(0), [images.map(i => i.id).join(",")]);

  return (
    <div className="relative aspect-square overflow-hidden rounded-lg">
      <div
        className="flex transition-transform duration-300 ease-out h-full"
        style={{ transform: `translateX(-${activeIndex * 100}%)` }}
      >
        {images.map((img, i) => (
          <button
            key={img.id}
            onClick={() => setLightboxOpen(true)}
            className="min-w-full h-full"
          >
            <Image
              src={resolveImageUrlSync(img) ?? ""}
              alt={img.alt_text ?? ""}
              fill
              priority={i === 0}
              sizes="(min-width: 768px) 50vw, 100vw"
              quality={85}
              className="object-cover"
            />
          </button>
        ))}
      </div>

      {/* Arrows */}
      {activeIndex > 0 && (
        <button onClick={() => setActiveIndex(i => i - 1)} className="...">‹</button>
      )}
      {activeIndex < images.length - 1 && (
        <button onClick={() => setActiveIndex(i => i + 1)} className="...">›</button>
      )}

      {/* Bullets */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveIndex(i)}
            className={`w-2 h-2 rounded-full ${i === activeIndex ? "bg-white" : "bg-white/50"}`}
          />
        ))}
      </div>

      {lightboxOpen && (
        <ImageLightbox
          images={images}
          startIndex={activeIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
```

### `ImageLightbox`

Full-screen overlay with the active image at maximum quality. Arrow keys + swipe navigation. Close on ESC / backdrop click.

---

## Background jobs

### Orphan reaper

Runs nightly via `pg_cron`. Deletes storage objects that:
- Have been in the bucket for ≥ 24 hours
- Aren't referenced by any `product_images.storage_key` or `media_assets.storage_key`

```sql
-- Pseudo (the actual implementation needs the storage_key listing
-- which requires a server-side action, not pure SQL — see below)
```

The reaper can't be pure SQL because it needs to list storage objects via the provider API. Implementation: a `/api/cron/reap-orphan-media` endpoint that:

1. Calls `provider.list({ bucket: "product-images" })` to get all keys
2. Calls Postgres: `SELECT storage_key FROM product_images UNION SELECT storage_key FROM media_assets`
3. Set-diff in JS: keys in storage but not in DB, AND older than 24h
4. Loops and calls `provider.delete(key)` for each

Scheduled by `cron.schedule('reap-orphan-media', '15 4 * * *', $$...$$)` via a Vercel cron job or an external scheduler hitting the endpoint.

---

## Phased rollout

Each phase is independently shippable + type-clean. Estimated total effort: ~25-35 hours.

### Phase 1 — Schema migration (1-2h)

**File:** `supabase/migrations/2026MMDDhhmmss_product_images_combo_model.sql`

- Add columns
- Backfill from existing data
- Add indexes
- No application code changes

**Validation:**
- All existing product_images rows have `attribute_combo` set (from variant_id backfill)
- `media_asset_id` set where storage_key/bucket match existing media_assets
- `is_cover` set from `is_primary` (legacy column)

**Rollback:** `ALTER TABLE ... DROP COLUMN` for the new ones; legacy columns remain.

### Phase 2 — Server actions (4-5h)

**Files:** `src/actions/products/images/*.ts` (new directory)

Implement the 7-8 server actions. They use the existing storage abstraction (`getStorageProvider()`) and read/write the new schema.

**Validation:** Each action has a smoke-test flow we can exercise from the existing admin interface (via curl or a temporary UI button).

**Rollback:** Per-action file revert.

### Phase 3 — Image processing utility (3-4h)

**Files:**
- `src/lib/media/imageProcessor.worker.ts`
- `src/lib/media/uploadProductImage.ts`
- Add `browser-image-compression` to `package.json`

Web Worker + orchestrator. Standalone module that any UI surface can call.

**Validation:**
- Worker correctly processes JPEG/PNG/WebP → WebP
- Magic-byte verification rejects ZIP, EXE, MP4, SVG
- Sample HEIC file should fail magic-byte (we don't accept HEIC for MVP)

**Rollback:** Delete files + remove dep.

### Phase 4 — Admin Images tab UI (8-10h)

**Files:**
- `src/components/admin/products/images/ProductImagesTab.tsx`
- `src/components/admin/products/images/ProductImageAxesSelector.tsx`
- `src/components/admin/products/images/ImageGroupList.tsx`
- `src/components/admin/products/images/ImageEditPane.tsx`
- `src/components/admin/products/images/ImageThumbnail.tsx`
- `src/components/admin/products/images/ImageLightbox.tsx`
- `src/components/admin/products/images/MediaPickerModal.tsx`
- Add `@dnd-kit/sortable` to `package.json`

The full admin experience. Replaces or sits alongside whatever existing "Images" surface exists in `/admin/products/[id]/edit`.

**Validation:** Manual exercise of every flow: upload, multi-upload, reorder, cover assignment, axis change, media picker, lightbox.

**Rollback:** Hide the new tab; legacy surface stays.

### Phase 5 — Storefront image selection algorithm (2-3h)

**Files:**
- `src/lib/products/selectImagesForVariant.ts` (the algorithm)
- Update `searchVariants` to use it for catalog cards
- Update `getProductBySlug` to pass `allImages` + the algorithm to ProductDetailInteractive

**Validation:**
- Product with image_axes = ["color"]: changing color picker swaps images
- Same product: changing size picker doesn't swap
- Product with image_axes = []: all images shown regardless of picker

**Rollback:** Per-file revert.

### Phase 6 — Carousel + lightbox (4-5h)

**Files:**
- `src/components/features/products/ImageCarousel.tsx`
- `src/components/features/products/ImageLightbox.tsx`
- Integrate into `ProductDetailInteractive.tsx`

Pure presentation work. Independent of data model changes.

**Validation:**
- Arrow navigation works
- Bullets indicate current
- Transition is smooth
- Lightbox opens / closes / navigates with keyboard

**Rollback:** Per-file revert; legacy gallery stays.

### Phase 7 — Orphan reaper (2-3h)

**Files:**
- `src/app/api/cron/reap-orphan-media/route.ts`
- `supabase/migrations/2026MMDDhhmmss_reap_orphan_media_cron.sql` (schedule)
- The provider abstraction needs a `list()` method added (see "TODO" below)

**Validation:** Run manually with a deliberately-orphaned test file; verify it's deleted after 24h sim.

**Rollback:** Unschedule the cron + delete the endpoint.

### Phase 8 — Cleanup (2h, do later)

After all callers migrated:
- Drop `product_images.url` column
- Drop `product_images.variant_id` column
- Drop `product_images.is_primary` column (replaced by `is_cover`)

Don't do this until you're confident no surface uses these.

---

## TODOs for the storage abstraction

To support this work, two additions to the existing `StorageProvider` interface:

```ts
// In src/lib/storage/types.ts:
export interface StorageProvider {
  // ... existing methods ...

  /**
   * Read the first N bytes of an object for magic-byte verification.
   * Implementations use HTTP Range header (S3) or Supabase's
   * range-fetch path.
   */
  readBytes(input: AssetCoordinate & { length: number }): Promise<Uint8Array>;

  /**
   * List object keys in a bucket. Used by the orphan reaper to compare
   * against DB. Paginated via continuation token.
   */
  list(input: { bucket: Bucket; prefix?: string; continuationToken?: string }): Promise<{
    keys: StorageKey[];
    nextToken?: string;
  }>;
}
```

These should ship as part of Phase 2 (when the server actions actually need them).

---

## Dependencies to add

```json
{
  "dependencies": {
    "browser-image-compression": "^2.0.2",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/core": "^6.1.0"
  },
  "optionalDependencies": {
    "sharp": "^0.33.0"
  }
}
```

`sharp` is optional — only required if a deployment sets `SERVER_SIDE_FORMAT_FALLBACK=true`.

---

## Summary

This document specifies a complete product image system that:

- **Models images cleanly** via attribute-combo subset matching
- **Decouples storage from app** via the existing StorageProvider abstraction
- **Enforces format integrity** with defense-in-depth WebP-only validation
- **Provides a coherent admin UI** that surfaces the conceptual model directly
- **Auto-handles common edge cases** (orphans, EXIF, format mismatches)

The total work is ~25-35 hours across 7 buildable phases. Phase 1 (schema) is shippable today and unblocks the rest in parallel. Phases 2-3 are the heaviest (server actions + image processing); Phases 4-6 are UI work; Phase 7 is operational hygiene.

Spec is locked. Ready to start with Phase 1 when you are.
