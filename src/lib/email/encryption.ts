import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM wrapper for email provider secrets (SMTP password, API key).
 *
 * Layout written to the DB (single bytea column):
 *   [ 12-byte IV ][ ciphertext (variable) ][ 16-byte auth tag ]
 *
 * The master key lives in the EMAIL_SECRETS_KEY env var as a base64-encoded
 * 32-byte value. Generate one with:
 *
 *     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Rotating the key requires re-encrypting every row — not automated here.
 * Loss of the key permanently breaks decryption of existing rows (no
 * recovery), but doesn't leak anything: a database dump alone is useless
 * without the env var.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // standard for GCM
const TAG_LEN = 16; // standard for GCM

function getKey(): Buffer {
  const raw = process.env.EMAIL_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "EMAIL_SECRETS_KEY env var is not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and add it to .env.local."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `EMAIL_SECRETS_KEY must decode to 32 bytes (got ${key.length}). Regenerate with the command above.`
    );
  }
  return key;
}

/** Encrypts a UTF-8 string into a single bytea blob (IV || ciphertext || tag). */
export function encryptSecret(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]);
}

/** Inverse of encryptSecret. Throws if the ciphertext is tampered or the key is wrong. */
export function decryptSecret(blob: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Encrypted blob too short — corrupted or wrong format.");
  }
  const key = getKey();
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Helper for the Supabase round-trip: bytea round-trips as a hex string
 * prefixed with `\x` when read, and accepts either hex strings or Buffers on
 * write. This converts the on-the-wire shape to a Buffer for decryption.
 */
export function bytesFromSupabase(value: string | Uint8Array | null | undefined): Buffer | null {
  if (value == null) return null;
  if (typeof value === "string") {
    // PostgREST renders bytea as `\xDEADBEEF…` by default.
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    return Buffer.from(hex, "hex");
  }
  return Buffer.from(value);
}
