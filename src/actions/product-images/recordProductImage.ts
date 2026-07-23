"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { getStorageProvider } from "@/lib/storage";
import { resolveProductImageUrl } from "@/lib/media/resolveProductImageUrl";
import { fail, ok, type Result } from "@/types/result";
import type { ProductImage } from "@/types/products";

const Schema = z.object({
  productId: z.string().uuid(),
  storageKey: z.string().min(1),
  bucket: z.string().min(1),
  /** The attribute_combo this image applies to. Empty = general. */
  attributeCombo: z.record(z.string(), z.string()).default({}),
  /** Optional manual alt-text override at upload time. */
  altText: z.string().max(500).optional(),
  /** Byte size of the uploaded WebP, reported by the client orchestrator
   * (processed.processedSize). Used to populate media_assets.size_bytes
   * for storage-usage reporting. The 20 MB cap is enforced at presign
   * time so callers can't claim arbitrary values. */
  sizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024).optional(),
});

/**
 * After the browser has uploaded bytes via the presigned URL from
 * requestProductImageUpload, this action:
 *
 *   1. Verifies the file actually arrived (provider.exists)
 *   2. Reads the first 16 bytes and validates the WebP magic-byte
 *      signature — defense in depth against client conversion bypass
 *      (zip-bombs, EXE renames, malformed JPEG-as-WebP, etc.)
 *   3. Inserts a media_assets row + a product_images row in one
 *      transactional flow
 *   4. Auto-generates alt_text from product.name + attribute_combo
 *      value labels (admin can override later via updateProductImage)
 *   5. Sets is_cover = true if this is the first image in its
 *      attribute_combo group for this product
 *   6. Invalidates caches: admin edit page + storefront product page
 *      + catalog facets tag
 *
 * On magic-byte mismatch: deletes the uploaded file (no orphan) and
 * returns NOT_WEBP. The browser surfaces the Greek error message:
 * "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά"
 *
 * The optional server-side fallback (sharp-based conversion) activates
 * when SERVER_SIDE_FORMAT_FALLBACK=true is set. Disabled by default
 * to keep the codebase free of the sharp dependency for deployments
 * that don't need it.
 */
export async function recordProductImage(
  input: z.input<typeof Schema>
): Promise<Result<ProductImage>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ProductImage>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductImage>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<ProductImage>("Not authenticated", "UNAUTHENTICATED");
  }

  const provider = await getStorageProvider();

  // 1. Confirm arrival.
  const exists = await provider.exists({
    bucket: parsed.data.bucket,
    key: parsed.data.storageKey,
  });
  if (!exists) {
    return fail<ProductImage>(
      "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά",
      "UPLOAD_NOT_FOUND"
    );
  }

  // 2. Magic-byte verification — WebP signature is "RIFF" at bytes
  //    0-3 and "WEBP" at bytes 8-11.
  let firstBytes: Uint8Array;
  try {
    firstBytes = await provider.readBytes({
      bucket: parsed.data.bucket,
      key: parsed.data.storageKey,
      length: 16,
    });
  } catch {
    await safeDelete(provider, parsed.data.bucket, parsed.data.storageKey);
    return fail<ProductImage>(
      "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά",
      "READ_FAILED"
    );
  }

  if (!isWebPSignature(firstBytes)) {
    // Optional server-side fallback: convert via sharp if env-enabled.
    if (process.env.SERVER_SIDE_FORMAT_FALLBACK === "true") {
      const converted = await tryServerSideConvertToWebP(
        provider,
        parsed.data.bucket,
        parsed.data.storageKey
      );
      if (!converted) {
        await safeDelete(provider, parsed.data.bucket, parsed.data.storageKey);
        return fail<ProductImage>(
          "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά",
          "NOT_WEBP"
        );
      }
    } else {
      await safeDelete(provider, parsed.data.bucket, parsed.data.storageKey);
      return fail<ProductImage>(
        "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά",
        "NOT_WEBP"
      );
    }
  }

  // 3. Load the product + attribute value labels for auto-alt-text.
  const admin = createAdminClient();
  const { data: productRow } = await admin
    .from("products")
    .select("id, name, slug")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (!productRow) {
    await safeDelete(provider, parsed.data.bucket, parsed.data.storageKey);
    return fail<ProductImage>("Product not found", "PRODUCT_NOT_FOUND");
  }
  const product = productRow as { id: string; name: string; slug: string };

  const autoAlt = await buildAutoAltText(
    admin,
    product.name,
    parsed.data.attributeCombo
  );
  const finalAltText = parsed.data.altText ?? autoAlt;
  const altIsAuto = parsed.data.altText === undefined;

  // 4. Insert media_assets row.
  const { data: mediaRow, error: mediaErr } = await admin
    .from("media_assets")
    .insert({
      uploader_id: authData.user.id,
      bucket: parsed.data.bucket,
      storage_key: parsed.data.storageKey,
      filename: parsed.data.storageKey.split("/").pop() ?? parsed.data.storageKey,
      mime_type: "image/webp",
      // Populated from the client orchestrator's processedSize. Capped
      // at 20MB by the schema (matches presign-time MAX_BYTES) so we
      // can trust the value enough for storage-usage reporting without
      // a server-side HEAD round-trip.
      size_bytes: parsed.data.sizeBytes ?? 0,
      alt_text: finalAltText,
      folder: `products/${product.slug}`,
      is_public: true,
    })
    .select("id")
    .single();
  if (mediaErr || !mediaRow) {
    await safeDelete(provider, parsed.data.bucket, parsed.data.storageKey);
    return fail<ProductImage>(
      mediaErr?.message ?? "media_assets insert failed",
      mediaErr?.code ?? "DB_ERROR"
    );
  }
  const mediaAssetId = (mediaRow as { id: string }).id;

  // 5. Compute display_order + decide is_cover.
  const { data: existing } = await admin
    .from("product_images")
    .select("id, display_order, attribute_combo, is_cover")
    .eq("product_id", parsed.data.productId);
  const sameGroup = (existing ?? []).filter((r) =>
    sameCombo(
      (r as { attribute_combo: Record<string, string> | null }).attribute_combo,
      parsed.data.attributeCombo
    )
  );
  const isFirstInGroup = sameGroup.length === 0;
  const maxOrder = sameGroup.reduce(
    (m, r) => Math.max(m, Number((r as { display_order: number }).display_order)),
    -1
  );

  // 6. Insert product_images row.
  const insertCombo =
    Object.keys(parsed.data.attributeCombo).length === 0
      ? null
      : parsed.data.attributeCombo;
  const { data: imgRow, error: imgErr } = await admin
    .from("product_images")
    .insert({
      product_id: parsed.data.productId,
      media_asset_id: mediaAssetId,
      bucket: parsed.data.bucket,
      storage_key: parsed.data.storageKey,
      url: null, // new uploads use storage_key path; url is legacy
      attribute_combo: insertCombo,
      alt_text: finalAltText,
      alt_text_is_auto: altIsAuto,
      display_order: maxOrder + 1,
      is_cover: isFirstInGroup,
    })
    .select()
    .single();
  if (imgErr || !imgRow) {
    // Rollback media_assets row + storage object on DB-side failure.
    await admin.from("media_assets").delete().eq("id", mediaAssetId);
    await safeDelete(provider, parsed.data.bucket, parsed.data.storageKey);
    return fail<ProductImage>(
      imgErr?.message ?? "product_images insert failed",
      imgErr?.code ?? "DB_ERROR"
    );
  }

  revalidatePath("/admin/products");
  revalidatePath(`/products/${product.slug}`);
  revalidatePath("/products");
  // No updateTag here — image changes don't affect catalog facets.

  // Populate url field via the storage abstraction so client receives
  // a non-null URL even though the legacy `url` DB column is now null.
  const resolved = await resolveProductImageUrl(imgRow as unknown as ProductImage);
  return ok(resolved);
}

// ─── helpers ──────────────────────────────────────────────────────────────

function isWebPSignature(bytes: Uint8Array): boolean {
  // RIFF magic at 0-3, WEBP marker at 8-11
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

function sameCombo(
  a: Record<string, string> | null,
  b: Record<string, string>
): boolean {
  const ak = a ? Object.keys(a) : [];
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  if (ak.length === 0) return true;
  return ak.every((k) => a![k] === b[k]);
}

async function safeDelete(
  provider: Awaited<ReturnType<typeof getStorageProvider>>,
  bucket: string,
  key: string
): Promise<void> {
  try {
    await provider.delete({ bucket, key });
  } catch {
    // Best-effort cleanup. If delete fails the orphan reaper will catch
    // the stragglers within 24h.
  }
}

async function buildAutoAltText(
  admin: ReturnType<typeof createAdminClient>,
  productName: string,
  combo: Record<string, string>
): Promise<string> {
  const valueIds = Object.values(combo);
  if (valueIds.length === 0) return productName;
  const { data: rows } = await admin
    .from("attribute_values")
    .select("id, value")
    .in("id", valueIds);
  const labelById = new Map(
    ((rows ?? []) as Array<{ id: string; value: string }>).map((r) => [
      r.id,
      r.value,
    ])
  );
  const labels = valueIds
    .map((id) => labelById.get(id))
    .filter((v): v is string => Boolean(v));
  if (labels.length === 0) return productName;
  return `${productName} — ${labels.join(" — ")}`;
}

/**
 * Optional server-side fallback. Returns true if conversion succeeded
 * (file at the storage key is now WebP). Disabled by default; opt in
 * via SERVER_SIDE_FORMAT_FALLBACK=true env.
 */
async function tryServerSideConvertToWebP(
  provider: Awaited<ReturnType<typeof getStorageProvider>>,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    // `sharp` is an OPT-IN dependency, gated behind
    // SERVER_SIDE_FORMAT_FALLBACK=true. Deployments that don't use the
    // fallback won't have sharp installed, and a static
    // `await import("sharp")` would fail at BUILD time even when the
    // env flag is off, because webpack/turbopack resolves module
    // identifiers statically.
    //
    // The Function-constructor trick computes the import path at
    // runtime, hiding the string from static analysis. The build
    // succeeds without sharp; the runtime call only fires when the
    // env flag enables this code path AND the dep is installed.
     
    const dynamicImport = new Function("p", "return import(p)") as (
      p: string
    ) => Promise<any>;
    const sharpModule = await dynamicImport("sharp");
    // eslint-disable-next-line
    const sharp = (sharpModule.default ?? sharpModule) as any;

    // Pull the full bytes via readBytes — capped by a sensible max.
    // For 20 MB max upload this is workable.
    const bytes = await provider.readBytes({
      bucket,
      key,
      length: 20 * 1024 * 1024,
    });
    const converted: Buffer = await sharp(bytes)
      .webp({ quality: 85 })
      .toBuffer();
    await provider.put({
      bucket,
      key, // Overwrite the same key
      body: converted,
      contentType: "image/webp",
      isPublic: true,
    });
    return true;
  } catch {
    return false;
  }
}
