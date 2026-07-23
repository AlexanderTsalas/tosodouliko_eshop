"use server";

import { z } from "zod";
import { randomUUID } from "crypto";
import { checkPermission } from "@/lib/rbac";
import {
  getStorageProvider,
  DEFAULT_PRODUCT_IMAGES_BUCKET,
} from "@/lib/storage";
import { fail, ok, type Result } from "@/types/result";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap
const PRESIGN_TTL_SECONDS = 300; // 5 min — admin has time to upload

// WebP-only contract — every layer enforces this:
//   1. Client orchestrator always converts the source file to WebP
//      before requesting an upload URL (see processImage.ts)
//   2. This server action only issues URLs for image/webp
//   3. The Supabase Storage bucket is configured `allowed_mime_types`
//      = ['image/webp'] so it rejects non-WebP at the storage layer
//   4. recordProductImage server-side magic-byte verifies the
//      uploaded bytes match the WebP signature (RIFF…WEBP) before
//      committing the DB row
// Defense in depth: if any layer is bypassed, the next one catches it.

const Schema = z.object({
  productId: z.string().uuid(),
  contentType: z.literal("image/webp"),
});

export interface RequestUploadResult {
  uploadUrl: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  storageKey: string;
  bucket: string;
}

/**
 * Issues a presigned URL the browser can use to upload bytes directly
 * to the configured storage backend (browser-direct upload pattern —
 * bypasses Vercel's 4.5 MB serverless body limit).
 *
 * The flow is two-step from the browser's POV:
 *   1. Browser calls THIS action to get the upload URL + computed key
 *   2. Browser PUTs the processed WebP bytes to that URL directly
 *   3. Browser calls recordProductImage() (separate action) to verify
 *      + record the DB row
 *
 * The 20 MB hard cap is enforced by the signed URL itself (the storage
 * backend rejects oversize bodies). The client should pre-validate to
 * avoid wasted upload bytes; the cap is the floor of trust.
 */
export async function requestProductImageUpload(
  input: z.input<typeof Schema>
): Promise<Result<RequestUploadResult>> {
  // Outer try/catch: defensive net for ANY uncaught exception in the
  // action body (auth chain, env-misconfigured storage, etc.). Without
  // this, an unexpected throw turns into a 500 with an unhelpful
  // browser message ("unexpected response from server"); with it, we
  // get a structured error the client can render meaningfully.
  try {
    const parsed = Schema.safeParse(input);
    if (!parsed.success) {
      return fail<RequestUploadResult>(
        "Invalid input: " + parsed.error.message,
        "INVALID_INPUT"
      );
    }

    let hasPermission = false;
    try {
      hasPermission = await checkPermission("manage:products");
    } catch (err) {
      console.error(
        "[requestProductImageUpload] checkPermission threw:",
        err instanceof Error ? err.message : err
      );
      return fail<RequestUploadResult>(
        "Permission check failed: " +
          (err instanceof Error ? err.message : "unknown"),
        "PERMISSION_CHECK_FAILED"
      );
    }
    if (!hasPermission) {
      return fail<RequestUploadResult>("Forbidden", "FORBIDDEN");
    }

    // Generate a unique key per upload to prevent admin-to-admin
    // collisions on simultaneous uploads to the same product. UUID
    // keeps the key opaque (no PII / no race conditions on filename).
    // Extension is always .webp — the schema only accepts image/webp.
    const storageKey = `${parsed.data.productId}/${randomUUID()}.webp`;
    const bucket = DEFAULT_PRODUCT_IMAGES_BUCKET;

    try {
      const provider = await getStorageProvider();
      const upload = await provider.signedUploadUrl({
        bucket,
        key: storageKey,
        contentType: parsed.data.contentType,
        ttlSeconds: PRESIGN_TTL_SECONDS,
        maxBytes: MAX_BYTES,
      });

      return ok({
        uploadUrl: upload.url,
        method: upload.method,
        headers: upload.headers,
        storageKey,
        bucket,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload URL issuance failed";
      console.error(
        "[requestProductImageUpload] storage provider threw:",
        message
      );
      return fail<RequestUploadResult>(message, "PROVIDER_ERROR");
    }
  } catch (err) {
    // Catch-all: anything we missed above. Keeps the action returning a
    // structured Result instead of bubbling a 500.
    const message =
      err instanceof Error ? err.message : "Unknown server error";
    console.error(
      "[requestProductImageUpload] UNCAUGHT:",
      message,
      err instanceof Error ? err.stack : ""
    );
    return fail<RequestUploadResult>(message, "UNCAUGHT_ERROR");
  }
}

