import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM wrapper for carrier provider credentials (ACS api key + 4-tuple,
 * ELTA token, etc.). Parallel to lib/email/encryption.ts but keyed by a
 * separate env var so an email-key compromise doesn't leak courier creds and
 * vice versa.
 *
 * Layout written to the DB (single bytea column):
 *   [ 12-byte IV ][ ciphertext (variable) ][ 16-byte auth tag ]
 *
 * The master key lives in the CARRIER_SECRETS_KEY env var as a base64-encoded
 * 32-byte value. Generate one with:
 *
 *     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.CARRIER_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "CARRIER_SECRETS_KEY env var is not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and add it to .env.local."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CARRIER_SECRETS_KEY must decode to 32 bytes (got ${key.length}). Regenerate with the command above.`
    );
  }
  return key;
}

export function encryptCarrierSecret(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]);
}

export function decryptCarrierSecret(blob: Buffer): string {
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
 * PostgREST returns bytea as `\xDEADBEEF…`. Converts that on-the-wire form
 * (or a raw Uint8Array) into a Buffer for decryption.
 */
export function bytesFromSupabase(value: string | Uint8Array | null | undefined): Buffer | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    return Buffer.from(hex, "hex");
  }
  return Buffer.from(value);
}
