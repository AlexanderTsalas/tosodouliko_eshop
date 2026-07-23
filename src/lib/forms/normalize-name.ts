import { NAME_DICT, type NameEntry } from "./greek-names";
import { SURNAME_DICT } from "./greek-surnames";
import type { CountryCode } from "libphonenumber-js";

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeForLookup(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .trim()
    .replace(/\s+/g, " ");
}

function isGreekText(s: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/.test(s);
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(/(\s+|-)/)
    .map((seg) =>
      /\s|-/.test(seg)
        ? seg
        : seg.charAt(0).toLocaleUpperCase("el") + seg.slice(1).toLocaleLowerCase("el")
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Longest Common Subsequence (for fuzzy matching)
// ---------------------------------------------------------------------------

function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Space-optimized 2-row DP.
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

// ---------------------------------------------------------------------------
// Resolve output from a NameEntry based on context
// ---------------------------------------------------------------------------

function resolveEntry(
  entry: NameEntry,
  inputIsGreek: boolean,
  phoneCountry: CountryCode
): string {
  if (entry.kind === "accent") {
    // Ambiguous variant → return the accented form matching the input script.
    return inputIsGreek ? entry.greek : entry.latin;
  }
  // Canonical entry. Latin input + Greek phone → output Greek canonical.
  // Latin input + non-Greek phone → keep Latin canonical.
  // Greek input → always Greek canonical.
  if (inputIsGreek) return entry.greek;
  if (phoneCountry === "GR" || phoneCountry === "CY") return entry.greek;
  return entry.latin;
}

// ---------------------------------------------------------------------------
// Fuzzy search — find the single best match in NAME_DICT
// ---------------------------------------------------------------------------

interface FuzzyCandidate {
  key: string;
  entry: NameEntry;
  distance: number;
  lcsCoverage: number;
}

function isSubsequence(input: string, key: string): boolean {
  let i = 0;
  for (let j = 0; j < key.length && i < input.length; j++) {
    if (key[j] === input[i]) i++;
  }
  return i === input.length;
}

function hasVowel(s: string): boolean {
  // Greek vowels (post-tonos-stripping) plus Latin vowels for transliterated input.
  return /[αεηιουωaeiou]/.test(s);
}

/**
 * Anchor check for the abbreviation pool. The user's first, middle, and
 * last letters of the typed input must align with the candidate key at
 * proportionally-similar positions. This mirrors how people recognize a
 * name from a fragment — start, middle, and end are the strongest signals.
 *
 *   - First and last: strict equality with key[0] and key[last].
 *   - Middle: one anchor for odd inputLen, two (left+right) for even,
 *     each checked at the proportional key position with ±1 tolerance to
 *     accommodate vowel-drop patterns where consonants don't sit at
 *     exactly proportional positions.
 */
function checkAbbrevAnchors(input: string, key: string): boolean {
  const inputLen = input.length;
  const keyLen = key.length;

  if (input[0] !== key[0]) return false;
  if (input[inputLen - 1] !== key[keyLen - 1]) return false;
  if (inputLen < 3) return true;

  const middles: number[] = inputLen % 2 === 0
    ? [inputLen / 2 - 1, inputLen / 2]
    : [Math.floor(inputLen / 2)];

  for (const i of middles) {
    const target = Math.round((i * (keyLen - 1)) / (inputLen - 1));
    const ch = input[i];
    let found = false;
    for (let d = -1; d <= 1 && !found; d++) {
      const p = target + d;
      if (p >= 0 && p < keyLen && key[p] === ch) found = true;
    }
    if (!found) return false;
  }

  return true;
}

const MAX_SUGGESTIONS = 3;

function fuzzySearch(
  normalized: string,
  inputIsGreek: boolean,
  phoneCountry: CountryCode,
  dict: ReadonlyMap<string, NameEntry>
): FuzzyCandidate[] {
  const inputLen = normalized.length;
  // Four admission paths feed a single ranked pool:
  //
  //   Lev pool: typos/substitutions ("κατρινα" → Κατερίνα). Bounded by maxDist.
  //   Abbrev pool: subseq with first+middle+last anchors, key ≤ 2×input length
  //     ("δσπνα" → Δέσποινα). Catches vowel-drop patterns.
  //   Skeleton pool: consonant-only inputs (no vowels, length ≥ 4) — first
  //     anchor + subseq only, since the user typed no vowels and we expect
  //     multiple plausible completions ("δμτρ" → Δημήτρης / Δήμητρα).
  //   Prefix pool: input is an exact prefix of the key, key ≤ input+4 length
  //     ("νικ" → Νίκη / Νίκος / Νικόλας). Surfaces likely completions.
  //
  // Returns up to MAX_SUGGESTIONS candidates, grouped by resolved output.
  // If one output strictly out-covers the rest it's the only suggestion;
  // otherwise the top N tied-or-close outputs are returned for the UI to
  // present as multi-suggestion chips.
  const maxDist = inputLen >= 6 ? 3 : inputLen >= 4 ? 2 : inputLen >= 3 ? 1 : 0;
  if (maxDist === 0) return [];

  const admitAbbrev = inputLen >= 4;
  const admitSkeleton = inputLen >= 4 && !hasVowel(normalized);
  const maxAbbrevKeyLen = inputLen * 2;
  const maxSkeletonKeyLen = Math.ceil(inputLen * 2.5);
  const maxPrefixKeyLen = inputLen + 4;
  const maxAdmittedKeyLen = Math.max(
    maxAbbrevKeyLen,
    admitSkeleton ? maxSkeletonKeyLen : 0,
    maxPrefixKeyLen
  );
  const firstChar = normalized[0];

  const candidates: FuzzyCandidate[] = [];

  for (const [key, entry] of dict) {
    const lenDiff = Math.abs(key.length - inputLen);
    // Skip only if every pool would reject on length grounds.
    if (lenDiff > maxDist + 1 && key.length > maxAdmittedKeyLen) continue;

    let admittedDist = Infinity;

    // Lev pool.
    if (lenDiff <= maxDist + 1) {
      const dist = levenshtein(normalized, key);
      if (dist > 0 && dist <= maxDist) admittedDist = dist;
    }

    // Abbreviation pool.
    if (
      admittedDist === Infinity &&
      admitAbbrev &&
      key.length > inputLen &&
      key.length <= maxAbbrevKeyLen &&
      checkAbbrevAnchors(normalized, key) &&
      isSubsequence(normalized, key)
    ) {
      admittedDist = key.length - inputLen;
    }

    // Skeleton pool — vowel-less input. No last/middle anchor (there are no
    // vowels typed, so anchoring middle vowels is impossible).
    if (
      admittedDist === Infinity &&
      admitSkeleton &&
      key.length > inputLen &&
      key.length <= maxSkeletonKeyLen &&
      key[0] === firstChar &&
      isSubsequence(normalized, key)
    ) {
      admittedDist = key.length - inputLen;
    }

    // Prefix pool — completions for short or incomplete inputs.
    if (
      admittedDist === Infinity &&
      key.length > inputLen &&
      key.length <= maxPrefixKeyLen &&
      key.startsWith(normalized)
    ) {
      admittedDist = key.length - inputLen;
    }

    if (admittedDist === Infinity) continue;

    const lcs = lcsLength(normalized, key);
    const coverage = inputLen > 0 ? lcs / inputLen : 0;

    candidates.push({ key, entry, distance: admittedDist, lcsCoverage: coverage });
  }

  if (candidates.length === 0) return [];

  // Group by resolved display output. Multiple keys can collapse into the
  // same name (Κατερίνα variants → one canonical) and shouldn't be
  // double-counted in the ambiguity check.
  const byOutput = new Map<string, FuzzyCandidate[]>();
  for (const c of candidates) {
    const output = resolveEntry(c.entry, inputIsGreek, phoneCountry);
    const list = byOutput.get(output);
    if (list) list.push(c);
    else byOutput.set(output, [c]);
  }

  // Best per output by (coverage desc, distance asc).
  const tops = Array.from(byOutput.values()).map((list) =>
    list.reduce((a, b) => {
      if (b.lcsCoverage !== a.lcsCoverage) return b.lcsCoverage > a.lcsCoverage ? b : a;
      return b.distance < a.distance ? b : a;
    })
  );
  tops.sort((a, b) => b.lcsCoverage - a.lcsCoverage || a.distance - b.distance);

  // Strict coverage winner → single suggestion. Otherwise return up to N tied.
  if (tops.length === 1 || tops[0].lcsCoverage > tops[1].lcsCoverage) {
    return [tops[0]];
  }
  return tops.slice(0, MAX_SUGGESTIONS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NameNormalizationResult {
  /** The resolved value to place in the input (Title Cased fallback for fuzzy). */
  value: string;
  /**
   * "exact"   → auto-applied on blur (high confidence)
   * "fuzzy"   → suggestions shown as chips, user clicks to accept
   * "fallback"→ just Title Case, no dictionary match
   */
  confidence: "exact" | "fuzzy" | "fallback";
  /**
   * Alternative names the user might have meant, distinct from `value`.
   * Empty for `exact` and `fallback`. Up to 3 entries for `fuzzy`. Compound
   * names produce cross-product entries (e.g., "Δμτρ Δσπνα" →
   * ["Δημήτρης Δέσποινα", "Δήμητρα Δέσποινα"]).
   */
  suggestions: string[];
}

interface SegmentResult {
  /** Contribution to the final `value` field. */
  primary: string;
  /**
   * Choices this segment contributes to the cross-product when composing
   * `suggestions`. For exact/fallback segments: just [primary]. For fuzzy
   * segments: alternative resolved canonicals (NOT primary, since primary
   * is what the user already typed/sees in the input).
   */
  choices: string[];
  isFuzzy: boolean;
}

/**
 * Internal: normalize against an arbitrary dict. Exposed publicly as
 * `normalizeNameAdvanced` (first names) and `normalizeSurnameAdvanced`
 * (surnames). The shape is identical — only the source dictionary differs.
 */
function normalizeAgainstDict(
  input: string,
  phoneCountry: CountryCode,
  dict: ReadonlyMap<string, NameEntry>
): NameNormalizationResult {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return { value: "", confidence: "fallback", suggestions: [] };

  const segments = trimmed.split(/(\s+|-)/);
  const segResults: SegmentResult[] = [];
  let hasFuzzy = false;
  let allExact = true;

  for (const seg of segments) {
    if (/^\s+$/.test(seg) || seg === "-") {
      segResults.push({ primary: seg, choices: [seg], isFuzzy: false });
      continue;
    }

    const inputIsGreek = isGreekText(seg);
    const normalized = normalizeForLookup(seg);

    const exactEntry = dict.get(normalized);
    if (exactEntry) {
      const resolved = resolveEntry(exactEntry, inputIsGreek, phoneCountry);
      segResults.push({ primary: resolved, choices: [resolved], isFuzzy: false });
      continue;
    }

    const fuzzyCandidates = fuzzySearch(normalized, inputIsGreek, phoneCountry, dict);
    if (fuzzyCandidates.length > 0) {
      const titleCased = titleCase(seg);
      const alternates = fuzzyCandidates.map((c) =>
        resolveEntry(c.entry, inputIsGreek, phoneCountry)
      );
      segResults.push({ primary: titleCased, choices: alternates, isFuzzy: true });
      hasFuzzy = true;
      allExact = false;
      continue;
    }

    const fallback = titleCase(seg);
    segResults.push({ primary: fallback, choices: [fallback], isFuzzy: false });
    allExact = false;
  }

  const value = segResults.map((s) => s.primary).join("");

  // Cross-product of per-segment choices, capped at MAX_SUGGESTIONS. For
  // non-fuzzy segments, choices = [primary] — they contribute a fixed string.
  // For fuzzy segments, choices = alternates — each one branches the product.
  let combos: string[] = [""];
  const CAP = MAX_SUGGESTIONS;
  for (const seg of segResults) {
    const next: string[] = [];
    outer: for (const combo of combos) {
      for (const choice of seg.choices) {
        next.push(combo + choice);
        // Cap growth: we'll trim to CAP at the end, but a 2x buffer keeps
        // enough diversity for the dedupe + value filter below.
        if (next.length >= CAP * 2) break outer;
      }
    }
    combos = next;
  }

  // Drop the all-primary combo (it equals `value` — no point suggesting it)
  // and dedupe.
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const c of combos) {
    if (c === value || seen.has(c)) continue;
    seen.add(c);
    suggestions.push(c);
    if (suggestions.length >= CAP) break;
  }

  const confidence: "exact" | "fuzzy" | "fallback" = hasFuzzy
    ? "fuzzy"
    : allExact
      ? "exact"
      : "fallback";

  return { value, confidence, suggestions };
}

/**
 * Normalize a first-name token (first_name field value).
 *
 * Splits on whitespace and hyphens, processes each token against the
 * Greek-first-names dictionary, then rejoins. Handles compound names like
 * "Anna-Maria" or "Μαρία Ελένη".
 *
 * @param input         Raw user input.
 * @param phoneCountry  The buyer's phone-country. Used to decide whether
 *                      Latin input is transliterated to Greek (GR/CY) or
 *                      kept Latin (everything else).
 */
export function normalizeNameAdvanced(
  input: string,
  phoneCountry: CountryCode = "GR"
): NameNormalizationResult {
  return normalizeAgainstDict(input, phoneCountry, NAME_DICT);
}

/**
 * Normalize a surname token (last_name field value). Same algorithm as
 * normalizeNameAdvanced but uses the Greek-surnames dictionary. Surnames
 * don't have diminutive variants, so the dict is built from straight
 * Latin↔Greek pairs.
 */
export function normalizeSurnameAdvanced(
  input: string,
  phoneCountry: CountryCode = "GR"
): NameNormalizationResult {
  return normalizeAgainstDict(input, phoneCountry, SURNAME_DICT);
}
