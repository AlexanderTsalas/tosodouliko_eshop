/**
 * Magic-byte verification for image formats. Used both client-side
 * (before upload) and as a reference for server-side checks.
 *
 * Rejecting at this layer is defense-in-depth: even if every other
 * client check is bypassed, a non-image file lands as `format=null`
 * and the upload short-circuits.
 *
 * Signatures covered:
 *   - JPEG: FF D8 FF
 *   - PNG:  89 50 4E 47 0D 0A 1A 0A
 *   - WebP: RIFF????WEBP  (52 49 46 46 ?? ?? ?? ?? 57 45 42 50)
 *   - GIF:  47 49 46 38 (GIF8) — also convertible to WebP
 *
 * NOT covered (will be rejected):
 *   - HEIC/HEIF (no broad encoder support in browsers yet)
 *   - TIFF (unusual for product photography)
 *   - SVG (XSS vector — never accept)
 *   - ZIP/EXE/PDF/MP4 (not image content)
 */

export type DetectedImageFormat = "jpeg" | "png" | "webp" | "gif" | null;

/**
 * Inspect the first 16 bytes of a file and identify the image format.
 * Returns null if no known image signature matches.
 */
export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF (the third byte varies — E0, E1, E8 etc. for marker
  // variants). We only check the first 3.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47 (header is 8 bytes total but the first 4 are
  // unique to PNG).
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }

  // WebP: RIFF at 0-3, WEBP at 8-11. Bytes 4-7 are little-endian file
  // size, varies per file.
  if (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "webp";
  }

  // GIF: 47 49 46 38 (GIF8 — covers both GIF87a and GIF89a)
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "gif";
  }

  return null;
}

/**
 * Read the first 16 bytes of a File / Blob without loading the whole
 * thing into memory. Browser-friendly.
 */
export async function readFirstBytes(file: Blob): Promise<Uint8Array> {
  const slice = file.slice(0, 16);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}
