import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "crypto";

/**
 * Token + recovery-code primitives for MFA hardening.
 *
 * Storage model: the DB stores SHA-256(plaintext || pepper) as hex; the
 * pepper lives in the MFA_TOKEN_PEPPER env var. Validation hashes the
 * input with the same pepper and compares constant-time.
 *
 * SHA-256 (not bcrypt/argon2) is deliberate:
 *   - Tokens are HIGH-ENTROPY (24 random bytes = 192 bits) — brute-forcing
 *     them is infeasible regardless of hash cost.
 *   - Recovery codes are LOWER entropy (~40 bits) but rate-limited at the
 *     application layer (single guess per submit, no parallel attack
 *     surface), so the offline-resistance of slow hashes doesn't buy
 *     much here either.
 *   - SHA-256 with a pepper allows direct equality lookup on the hash
 *     column. Slow hashes (bcrypt) can't be looked up — every active
 *     token would need to be hashed against the input, which is both
 *     slow and a timing-side-channel risk.
 *
 * The pepper provides defense against an attacker with read-only DB
 * access but no app-server access: knowing the token_hash without the
 * pepper means rainbow-table-style attacks must include the pepper in
 * the search, raising cost.
 */

function pepper(): string {
  const v = process.env.MFA_TOKEN_PEPPER;
  if (!v || v.length < 32) {
    throw new Error(
      "MFA_TOKEN_PEPPER is missing or too short (needs >= 32 characters). Set it in .env.local (and Vercel) — generate with `openssl rand -base64 32`."
    );
  }
  return v;
}

/**
 * Generates a 24-byte random token, base64url-encoded. Result is ~32
 * URL-safe characters with 192 bits of entropy. Safe to put in a URL
 * query parameter.
 */
export function generateEnrollmentToken(): string {
  return randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generates a recovery code in `XXXX-XXXX` format using crypto-safe
 * randomness over an alphabet that avoids visually-ambiguous characters
 * (0/O, 1/I/L) so admins can transcribe them by hand if needed.
 *
 * Entropy: 8 chars × log2(32) ≈ 40 bits per code. Rate-limited at the
 * verify endpoint to make online guessing impractical; codes are
 * single-use so a guessed code self-destructs.
 */
export function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(8);
  const chars: string[] = [];
  for (let i = 0; i < 8; i++) {
    chars.push(alphabet[buf[i] % alphabet.length]);
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Hash a plaintext value (token or recovery code) for storage. */
export function hashSecret(plaintext: string): string {
  return createHash("sha256")
    .update(plaintext + pepper(), "utf8")
    .digest("hex");
}

/**
 * Constant-time hex-string equality check. Both sides are expected to
 * be hex-encoded SHA-256 outputs (64 chars). Returns false on length
 * mismatch without leaking timing.
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
