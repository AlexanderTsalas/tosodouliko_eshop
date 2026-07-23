"use client";

import { processImageForUpload } from "./processImage";
import { requestProductImageUpload } from "@/actions/product-images/requestProductImageUpload";

/**
 * Create-mode counterpart to uploadProductImage().
 *
 * The edit-mode orchestrator runs 4 stages:
 *   1. process     — Web Worker WebP conversion + magic-byte verify
 *   2. requestUrl  — server action issues a presigned upload URL
 *   3. PUT bytes   — browser uploads directly to storage
 *   4. record      — server action verifies bytes + creates DB rows
 *
 * Create mode can run 1-3 unchanged but CANNOT run stage 4: the
 * `product_images` row needs a real `product_id` FK, and the product
 * doesn't exist yet. Instead, this orchestrator stops after stage 3
 * and returns the staged metadata; the caller stores it in the
 * ProductForm's local state, and `createProduct` later inserts the
 * media_assets + product_images rows in the same transaction-ish
 * flow as the product itself.
 *
 * If the user abandons the create flow, the uploaded bytes are
 * unreferenced in storage. The nightly orphan-media reaper deletes
 * them after the 24h grace window (cleanup is automatic).
 *
 * The `tempProductId` is a client-generated UUID used purely as a
 * storage_key prefix — it never references a real DB row. After
 * product creation the storage_keys are stored as-is in
 * product_images.storage_key; the path doesn't need to match the
 * actual product id.
 */
export type StagedUploadStage = "processing" | "requesting_url" | "uploading";

export type StagedUploadError =
  | "INVALID_FORMAT"
  | "TOO_LARGE"
  | "IMPORT_FAILED"
  | "COMPRESSION_FAILED"
  | "URL_REQUEST_FAILED"
  | "UPLOAD_FAILED";

export interface StagedUploadResult {
  storageKey: string;
  bucket: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** The uploaded blob, retained for thumbnail display (revoke-on-unmount
   * is the caller's responsibility — see ProductForm's create flow). */
  blob: Blob;
}

export interface UploadStagedInput {
  file: File;
  /** Client-generated UUID used only for the storage_key prefix. */
  tempProductId: string;
  onProgress?: (stage: StagedUploadStage) => void;
}

export async function uploadProductImageStaged(
  input: UploadStagedInput
): Promise<{ ok: true; data: StagedUploadResult } | { ok: false; error: StagedUploadError; detail?: string }> {
  console.info(
    "[uploadProductImageStaged] start",
    { tempProductId: input.tempProductId, filename: input.file.name }
  );

  // Stage 1 — process file (WebP convert + downscale if needed)
  input.onProgress?.("processing");
  const processed = await processImageForUpload(input.file);
  if (!processed.ok) {
    console.error(
      "[uploadProductImageStaged] STAGE 1 (processing) failed:",
      processed.error,
      "detail" in processed ? processed.detail : undefined
    );
    return {
      ok: false,
      error: processed.error,
      detail: "detail" in processed ? processed.detail : undefined,
    };
  }

  // Stage 2 — request presigned upload URL. requestProductImageUpload
  // accepts any uuid for productId — it doesn't verify the row exists,
  // just uses it as a path prefix.
  input.onProgress?.("requesting_url");
  const urlResult = await requestProductImageUpload({
    productId: input.tempProductId,
    contentType: "image/webp",
  });
  if (!urlResult.success) {
    console.error(
      "[uploadProductImageStaged] STAGE 2 (requesting_url) failed:",
      urlResult.error
    );
    return {
      ok: false,
      error: "URL_REQUEST_FAILED",
      detail: urlResult.error,
    };
  }
  console.info(
    "[uploadProductImageStaged] STAGE 2 ok — presigned URL issued",
    { bucket: urlResult.data.bucket, key: urlResult.data.storageKey }
  );

  // Stage 3 — browser-direct PUT
  input.onProgress?.("uploading");
  try {
    const putRes = await fetch(urlResult.data.uploadUrl, {
      method: urlResult.data.method,
      headers: urlResult.data.headers,
      body: processed.data.blob,
    });
    if (!putRes.ok) {
      const responseBody = await putRes.text().catch(() => "");
      console.error(
        "[uploadProductImageStaged] STAGE 3 (PUT) failed:",
        `HTTP ${putRes.status} ${putRes.statusText}`,
        responseBody
      );
      return {
        ok: false,
        error: "UPLOAD_FAILED",
        detail: `HTTP ${putRes.status}: ${putRes.statusText}${responseBody ? " — " + responseBody : ""}`,
      };
    }
    console.info("[uploadProductImageStaged] STAGE 3 ok — bytes uploaded");
  } catch (err) {
    console.error("[uploadProductImageStaged] STAGE 3 (PUT) threw:", err);
    return {
      ok: false,
      error: "UPLOAD_FAILED",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Done — return the staged metadata. NO recordProductImage call
  // because the product doesn't exist yet. createProduct handles the
  // DB inserts atomically on submit.
  return {
    ok: true,
    data: {
      storageKey: urlResult.data.storageKey,
      bucket: urlResult.data.bucket,
      sizeBytes: processed.data.processedSize,
      width: processed.data.width,
      height: processed.data.height,
      blob: processed.data.blob,
    },
  };
}
