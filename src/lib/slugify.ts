/**
 * Greek → Latin transliteration table. Matches the table in
 * `variants-helpers.ts` so both slug paths produce the same output for
 * the same Greek input.
 */
const GREEK_TO_LATIN: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th",
  ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p",
  ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/**
 * URL-safe slug from arbitrary text. Handles:
 *   - Greek letters via the GREEK_TO_LATIN transliteration map (so
 *     "Ποιότητα Υφάσματος" becomes "poiotita-yfasmatos", not "")
 *   - Latin diacritics via NFKD decomposition + diacritic strip
 *   - Spaces / punctuation collapsed to single hyphens
 *
 * The previous implementation only stripped diacritics and then
 * filtered to `[a-z0-9\s-]` — that produced an empty string for
 * all-Greek input, which then collided on the attributes.slug UNIQUE
 * constraint with any prior empty slug. This version transliterates
 * Greek first so the slug always carries content.
 */
export function slugify(input: string): string {
  const lower = input.toLowerCase().normalize("NFKD");
  let transliterated = "";
  for (const ch of lower) {
    if (GREEK_TO_LATIN[ch]) {
      transliterated += GREEK_TO_LATIN[ch];
    } else {
      transliterated += ch;
    }
  }
  return transliterated
    .replace(/[̀-ͯ]/g, "") // strip Latin combining diacritics post-NFKD
    .replace(/[^a-z0-9]+/g, "-") // anything non-alphanumeric → hyphen
    .replace(/^-|-$/g, ""); // trim hyphens from edges
}
