"use client";

import { processImageForUpload } from "./processImage";
import { requestProductImageUpload } from "@/actions/product-images/requestProductImageUpload";
import { recordProductImage } from "@/actions/product-images/recordProductImage";
import type { ProductImage } from "@/types/products";

/**
 * End-to-end browser-side upload orchestrator.
 *
 * Stage 1: process the file in Web Worker (WebP convert + downscale)
 * Stage 2: request presigned URL from the server action
 * Stage 3: PUT bytes directly to storage (bypasses Vercel function limits)
 * Stage 4: tell server "uploaded — verify + record"
 *
 * The server-side magic-byte verify in stage 4 is the final defense:
 * even if a malicious admin bypasses stages 1-3 with arbitrary bytes,
 * the server-side check rejects non-WebP and surfaces the Greek
 * error message:
 *   "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά"
 *
 * The `onProgress` callback lets UI components show a per-stage progress
 * indicator. Each stage is a discrete step the admin sees.
 */
export type UploadStage =
  | "processing"
  | "requesting_url"
  | "uploading"
  | "recording";

export interface UploadResult {
  productImage: ProductImage;
  bytesIn: number;
  bytesOut: number;
}

export type UploadError =
  | "INVALID_FORMAT"
  | "TOO_LARGE"
  | "IMPORT_FAILED"
  | "COMPRESSION_FAILED"
  | "URL_REQUEST_FAILED"
  | "UPLOAD_FAILED"
  | "RECORD_FAILED";

export interface UploadProductImageInput {
  file: File;
  productId: string;
  attributeCombo: Record<string, string>;
  altTextOverride?: string;
  onProgress?: (stage: UploadStage) => void;
}

export async function uploadProductImage(
  input: UploadProductImageInput
): Promise<{ ok: true; data: UploadResult } | { ok: false; error: UploadError; detail?: string }> {
  console.info(
    "[uploadProductImage] start",
    { productId: input.productId, filename: input.file.name }
  );

  // Stage 1 — process file (WebP convert + downscale if needed)
  input.onProgress?.("processing");
  const processed = await processImageForUpload(input.file);
  if (!processed.ok) {
    console.error(
      "[uploadProductImage] STAGE 1 (processing) failed:",
      processed.error,
      "detail" in processed ? processed.detail : undefined
    );
    return {
      ok: false,
      error: processed.error,
      detail: "detail" in processed ? processed.detail : undefined,
    };
  }

  // Stage 2 — request presigned upload URL
  input.onProgress?.("requesting_url");
  const urlResult = await requestProductImageUpload({
    productId: input.productId,
    contentType: "image/webp",
  });
  if (!urlResult.success) {
    console.error(
      "[uploadProductImage] STAGE 2 (requesting_url) failed:",
      urlResult.error,
      urlResult.code
    );
    return {
      ok: false,
      error: "URL_REQUEST_FAILED",
      detail: urlResult.error,
    };
  }
  console.info(
    "[uploadProductImage] STAGE 2 ok — presigned URL issued",
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
        "[uploadProductImage] STAGE 3 (PUT) failed:",
        `HTTP ${putRes.status} ${putRes.statusText}`,
        responseBody
      );
      return {
        ok: false,
        error: "UPLOAD_FAILED",
        detail: `HTTP ${putRes.status}: ${putRes.statusText}${responseBody ? " — " + responseBody : ""}`,
      };
    }
    console.info("[uploadProductImage] STAGE 3 ok — bytes uploaded to storage");
  } catch (err) {
    console.error("[uploadProductImage] STAGE 3 (PUT) threw:", err);
    return {
      ok: false,
      error: "UPLOAD_FAILED",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Stage 4 — verify + record server-side (this is where magic-byte
  // verify fires)
  input.onProgress?.("recording");
  const recordResult = await recordProductImage({
    productId: input.productId,
    storageKey: urlResult.data.storageKey,
    bucket: urlResult.data.bucket,
    attributeCombo: input.attributeCombo,
    altText: input.altTextOverride,
    sizeBytes: processed.data.processedSize,
  });
  if (!recordResult.success) {
    console.error(
      "[uploadProductImage] STAGE 4 (record) failed:",
      recordResult.error,
      recordResult.code
    );
    return {
      ok: false,
      error: "RECORD_FAILED",
      detail: recordResult.error,
    };
  }

  console.info("[uploadProductImage] complete", { id: recordResult.data.id });
  return {
    ok: true,
    data: {
      productImage: recordResult.data,
      bytesIn: processed.data.originalSize,
      bytesOut: processed.data.processedSize,
    },
  };
}

/**
 * Greek user-facing error messages for each UploadError code. Use in
 * UI components to surface what went wrong.
 */
export function errorMessageEl(error: UploadError): string {
  switch (error) {
    case "INVALID_FORMAT":
      return "Μη υποστηριζόμενος τύπος αρχείου. Παρακαλώ ανεβάστε εικόνα (JPEG, PNG, WebP).";
    case "TOO_LARGE":
      return "Το αρχείο είναι μεγαλύτερο από 20 MB. Παρακαλώ ανεβάστε μικρότερο αρχείο.";
    case "IMPORT_FAILED":
      // Surfaces when the browser-image-compression library fails to
      // load. Real cause is in browser console (see [processImage] log).
      return "Δεν φορτώθηκε το εργαλείο επεξεργασίας εικόνας. Παρακαλώ ανανεώστε τη σελίδα.";
    case "COMPRESSION_FAILED":
      // The compression call threw — typically an unsupported source
      // format (HEIC from some iPhones) or a corrupt file.
      return "Δεν ήταν δυνατή η επεξεργασία του αρχείου. Δοκιμάστε μετατροπή σε JPEG/PNG πρώτα.";
    case "URL_REQUEST_FAILED":
      return "Δεν ήταν δυνατή η έναρξη της μεταφόρτωσης. Παρακαλώ προσπαθήστε ξανά";
    case "UPLOAD_FAILED":
      return "Η μεταφόρτωση απέτυχε. Παρακαλώ ελέγξτε τη σύνδεσή σας και προσπαθήστε ξανά";
    case "RECORD_FAILED":
      return "Υπήρξε ένα θέμα στην ανάγνωση του Αρχείου. Παρακαλώ προσπαθήστε ξανά";
  }
}
