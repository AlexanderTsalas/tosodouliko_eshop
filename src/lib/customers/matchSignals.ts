import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, normalizePhone } from "./normalize";
import type { Customer } from "@/types/customer";

/**
 * Customer match scoring — used by both matchOrCreateCustomer (admin
 * manual order entry) and placeOrder (eshop checkout, to detect when
 * a returning guest collides with an existing offline customer the
 * admin created earlier).
 *
 * Why a weighted system instead of strict AND-of-fields:
 * The previous behavior required BOTH email AND phone to match, which
 * misses the most common real-world dedupe case — an admin enters a
 * customer offline with just name + phone (no email, because they got
 * those on the phone), then the same person later signs up online
 * with a new email. Strict email+phone never matches that pair.
 *
 * Confidence tiers:
 *   - HIGH: unambiguous match, safe to auto-merge / auto-attach
 *   - MEDIUM: probable match, prompt admin to confirm
 *   - LOW: weak signal, surface as a "review queue" hint, never auto-act
 *
 * Signals and weights (each contributes to a total score):
 *   email_normalized exact         → +50
 *   phone_normalized exact          → +40
 *   first_name + last_name exact    → +20 (case-insensitive normalized)
 *   last_name alone                 → +5 (too common to weight more)
 *   first_name alone                → +3
 *   shipping postal_code overlap    → +5
 *
 * Score thresholds — DESIGNED so phone alone is NOT enough:
 *   ≥ 60 → HIGH  (phone+name combo, OR email+phone, OR email+name combo)
 *   ≥ 45 → MEDIUM (phone+last_name, phone+postal_code, email-only)
 *   ≥ 25 → LOW   (informational — phone alone, name combo alone)
 *   < 25 → not a match
 *
 * Why phone alone is intentionally LOW: phone numbers get shared
 * across family members, landlines, even reassigned to new
 * subscribers over years. Treating phone-only as a confident match
 * led to false-positive merges. The rule now requires at least ONE
 * corroborating signal (any of name component, postcode, email).
 */

export type MatchConfidence = "high" | "medium" | "low";

export interface CustomerMatch {
  customer: Customer;
  score: number;
  confidence: MatchConfidence;
  /** Human-readable reasons the match fired — for admin UI captions. */
  reasons: string[];
}

export interface MatchInput {
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  postal_code?: string | null;
}

/** Lowercase + collapse whitespace + trim. Empty → null. */
function normalizeName(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

function scoreCandidate(
  input: MatchInput,
  candidate: Customer
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const emailIn = normalizeEmail(input.email);
  const phoneIn = normalizePhone(input.phone);
  const firstIn = normalizeName(input.first_name);
  const lastIn = normalizeName(input.last_name);
  const zipIn = input.postal_code?.trim() || null;

  const emailCand = normalizeEmail(candidate.email);
  const phoneCand = normalizePhone(candidate.phone);
  const firstCand = normalizeName(candidate.first_name);
  const lastCand = normalizeName(candidate.last_name);

  if (emailIn && emailCand && emailIn === emailCand) {
    score += 50;
    reasons.push("email");
  }
  if (phoneIn && phoneCand && phoneIn === phoneCand) {
    score += 40;
    reasons.push("phone");
  }
  // Name combo: only fires when BOTH first AND last match (a single name
  // match is too weak in a small-name-pool language like Greek).
  if (firstIn && lastIn && firstIn === firstCand && lastIn === lastCand) {
    score += 20;
    reasons.push("όνομα + επώνυμο");
  } else {
    // Partial name signal — never alone enough, but accumulates.
    if (lastIn && lastCand && lastIn === lastCand) {
      score += 5;
      reasons.push("επώνυμο");
    }
    if (firstIn && firstCand && firstIn === firstCand) {
      score += 3;
      reasons.push("όνομα");
    }
  }
  // Address overlap is a tertiary signal — same postcode often means same
  // family/household. Skipped if not provided.
  if (zipIn) {
    // Candidate's last-known postcode lives in customers.last_address_zip
    // when populated, otherwise we need the most recent order's address.
    // To keep the signal cheap, only inspect the column already on Customer
    // (if present). Skipped silently when absent.
    const candZip = (candidate as unknown as { last_address_zip?: string | null })
      .last_address_zip;
    if (candZip && candZip.trim() === zipIn) {
      score += 5;
      reasons.push("ίδιος ΤΚ");
    }
  }

  return { score, reasons };
}

function confidenceFromScore(score: number): MatchConfidence | null {
  if (score >= 60) return "high";
  if (score >= 45) return "medium";
  if (score >= 25) return "low";
  return null;
}

/**
 * Query candidates whose email_normalized OR phone_normalized matches.
 * This is the cheap pre-filter — name matches alone don't get fetched.
 * Then we score each fetched candidate against the input and tier them.
 *
 * @param onlyOffline When true, restricts to customers with auth_user_id
 *                    IS NULL — used by placeOrder to detect "did the
 *                    admin already enter this person manually?"
 */
export async function findCustomerMatches(
  admin: SupabaseClient,
  input: MatchInput,
  options: { onlyOffline?: boolean } = {}
): Promise<CustomerMatch[]> {
  const emailIn = normalizeEmail(input.email);
  const phoneIn = normalizePhone(input.phone);

  if (!emailIn && !phoneIn) {
    // No strong signals to query on. The matcher would not return useful
    // results from name alone (too many false positives) — skip.
    return [];
  }

  // Build OR query: email_normalized = X OR phone_normalized = Y. We
  // collect a small candidate pool, then score in JS.
  const orClauses: string[] = [];
  if (emailIn) orClauses.push(`email_normalized.eq.${emailIn}`);
  if (phoneIn) orClauses.push(`phone_normalized.eq.${phoneIn}`);

  let q = admin
    .from("customers")
    .select("*")
    .or(orClauses.join(","))
    .limit(20);
  if (options.onlyOffline) q = q.is("auth_user_id", null);

  const { data, error } = await q;
  if (error || !data) return [];

  const matches: CustomerMatch[] = [];
  for (const candidate of data as Customer[]) {
    const { score, reasons } = scoreCandidate(input, candidate);
    const confidence = confidenceFromScore(score);
    if (!confidence) continue;
    matches.push({ customer: candidate, score, confidence, reasons });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}
