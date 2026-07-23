"use client";

import { detectImageFormat, readFirstBytes } from "./magicBytes";

/**
 * Client-side image processing for product image uploads.
 *
 *   1. Magic-byte verify (reject non-image formats — SVG, ZIP, EXE, ...)
 *   2. Convert to WebP at quality 85 (re-encoding strips EXIF
 *      automatically — privacy)
 *   3. Downscale only if longest dimension > 4000px (preserves zoom
 *      quality for typical product photography)
 *
 * Runs in a Web Worker via the browser-image-compression library — does
 * not block the main thread. Typical processing time:
 *
 *   - 3000×4000 phone JPEG → WebP 85: 300-500ms (no downscale)
 *   - 5000×3500 DSLR + downscale to 4000px wide + WebP: 600-1000ms
 *
 * Every failure path logs to console.error with context so admins
 * debugging a failed upload can see exactly which step broke instead
 * of an opaque "PROCESSING_FAILED" code.
 */
export interface ProcessImageResult {
  blob: Blob;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
}

export type ProcessImageError =
  | "INVALID_FORMAT" // magic-byte verify failed
  | "IMPORT_FAILED" // browser-image-compression dynamic import threw
  | "COMPRESSION_FAILED" // imageCompression() threw
  | "TOO_LARGE"; // exceeds the 20MB raw upload cap

export const MAX_RAW_BYTES = 20 * 1024 * 1024;
export const MAX_LONGEST_DIMENSION = 4000;
export const TARGET_QUALITY = 0.85;

/**
 * Process a file into a WebP blob ready for direct upload.
 *
 * Library import is dynamic so the bundle pays the cost only when an
 * upload actually fires. Loading the dep on every page would add
 * ~30KB gzipped to the initial bundle.
 */
export async function processImageForUpload(
  file: File
): Promise<{ ok: true; data: ProcessImageResult } | { ok: false; error: ProcessImageError; detail?: string }> {
  console.info(
    "[processImage] start",
    { name: file.name, size: file.size, type: file.type }
  );

  // Hard cap on raw size — defends against malicious huge uploads
  // before any processing CPU is spent.
  if (file.size > MAX_RAW_BYTES) {
    console.warn("[processImage] TOO_LARGE", file.size, ">", MAX_RAW_BYTES);
    return { ok: false, error: "TOO_LARGE" };
  }

  // Magic-byte verification — rejects ZIPs, EXEs, SVGs, etc. that
  // claim to be images via Content-Type or extension.
  const firstBytes = await readFirstBytes(file);
  const format = detectImageFormat(firstBytes);
  if (format === null) {
    console.warn(
      "[processImage] INVALID_FORMAT — magic-byte verify failed",
      Array.from(firstBytes).slice(0, 8).map((b) => b.toString(16))
    );
    return { ok: false, error: "INVALID_FORMAT" };
  }
  console.info("[processImage] detected format:", format);

  // Dynamic import of the compression library. Logs the actual error
  // so debugging never gets stuck on a generic PROCESSING_FAILED.
  let imageCompression: (file: File, opts: object) => Promise<Blob>;
  try {
    const mod = await import("browser-image-compression");
    // ESM default export — `.default` is the function. CJS fallback
    // via `?? mod` for older bundler shapes that don't unwrap.
    imageCompression =
      (mod.default as unknown as typeof imageCompression) ??
      (mod as unknown as typeof imageCompression);
    if (typeof imageCompression !== "function") {
      console.error(
        "[processImage] IMPORT_FAILED — module loaded but no function export. Module shape:",
        Object.keys(mod)
      );
      return {
        ok: false,
        error: "IMPORT_FAILED",
        detail: "browser-image-compression loaded but no function export",
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[processImage] IMPORT_FAILED — dynamic import threw:", err);
    return { ok: false, error: "IMPORT_FAILED", detail: message };
  }

  let processed: Blob;
  try {
    processed = await imageCompression(file, {
      maxWidthOrHeight: MAX_LONGEST_DIMENSION,
      fileType: "image/webp",
      initialQuality: TARGET_QUALITY,
      useWebWorker: true, // off-main-thread
      // alwaysKeepResolution lets us upscale-skip — only downscale, never grow
      alwaysKeepResolution: false,
    });
    console.info(
      "[processImage] compressed:",
      `${file.size} → ${processed.size} bytes (${((processed.size / file.size) * 100).toFixed(1)}%)`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[processImage] COMPRESSION_FAILED — imageCompression threw:",
      err
    );
    return { ok: false, error: "COMPRESSION_FAILED", detail: message };
  }

  // Get the processed image's dimensions for the result. We do this by
  // creating an Image element and reading naturalWidth/Height; cheap
  // because the bytes are already in memory.
  const dimensions = await readDimensions(processed);

  return {
    ok: true,
    data: {
      blob: processed,
      originalSize: file.size,
      processedSize: processed.size,
      width: dimensions.width,
      height: dimensions.height,
    },
  };
}

async function readDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const out = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
