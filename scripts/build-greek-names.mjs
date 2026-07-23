/**
 * One-off generator: reads Greek_First_Names_and_Variants.csv and emits
 * src/lib/forms/greek-names.ts — a TypeScript module exporting NAME_DICT.
 *
 * Run:  node scripts/build-greek-names.mjs
 *
 * Re-run whenever the CSV changes; commit the generated .ts file.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../docs/data/Greek_First_Names_and_Variants.csv");
const OUT_PATH = resolve(__dirname, "../src/lib/forms/greek-names.ts");

// ---------------------------------------------------------------------------
// CSV parse (handles quoted fields with internal commas)
// ---------------------------------------------------------------------------
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// Normalization (mirrors the runtime normalizeForLookup)
// ---------------------------------------------------------------------------
function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const csv = readFileSync(CSV_PATH, "utf-8");
const lines = csv.split("\n").filter(Boolean);
const header = lines[0];
const dataLines = lines.slice(1);

// Step 1: parse every row into a name group.
const groups = [];
for (const line of dataLines) {
  const cols = parseCsvLine(line);
  const canonLatin = (cols[0] || "").trim();
  const canonGreek = (cols[1] || "").trim();
  if (!canonLatin || !canonGreek) continue;

  const varsLatin = (cols[2] || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const varsGreek = (cols[3] || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  groups.push({ canonLatin, canonGreek, varsLatin, varsGreek });
}

// Step 2: build a raw key→group index, tracking collisions.
// Each key maps to { accentedLatin, accentedGreek, groupIndex, isCanonical }.
const rawEntries = new Map(); // normalized → [{ ... }]

for (let gi = 0; gi < groups.length; gi++) {
  const g = groups[gi];

  function addKey(normalizedKey, accentedLatin, accentedGreek, isCanonical) {
    if (!normalizedKey) return;
    const arr = rawEntries.get(normalizedKey) || [];
    arr.push({ gi, accentedLatin, accentedGreek, isCanonical });
    rawEntries.set(normalizedKey, arr);
  }

  // Canonical keys
  addKey(normalize(g.canonLatin), g.canonLatin, g.canonGreek, true);
  addKey(normalize(g.canonGreek), g.canonLatin, g.canonGreek, true);

  // Variant keys store the variant's own form in its own script and the
  // canonical's form in the cross-script slot. We do NOT positionally pair
  // Latin[i] with Greek[i] because the CSV's two variant lists are not
  // reliably aligned across the file (e.g. row 157 has "Helene" Latin at
  // position 1 paired with "Έλενα" Greek at position 1, but Helene is the
  // Latin for canonical Ελένη, not Έλενα). Using canonical for cross-script
  // is conservative but never wrong; positional pairing would silently
  // mis-transliterate Latin input to the wrong Greek variant.
  //
  // Result: typing Greek "Ιωάννης" preserves Ιωάννης. Typing Latin "Ioannis"
  // on a GR phone yields canonical "Γιάννης" (we don't know which Greek
  // variant the user meant).
  for (const vl of g.varsLatin) {
    addKey(normalize(vl), vl, g.canonGreek, false);
  }
  for (const vg of g.varsGreek) {
    addKey(normalize(vg), g.canonLatin, vg, false);
  }
}

// Step 3: resolve collisions.
//   - If exactly one entry claims the key as canonical → kind: "canonical"
//   - If multiple entries but one is canonical → canonical wins, kind: "canonical"
//   - If all entries are variants (no canonical claims) → kind: "accent",
//     pick the accented form from the first entry (they should agree on the
//     spelling of the variant itself).
const dict = new Map(); // normalized → { kind, latin, greek }

let canonicalWins = 0;
let accentFallbacks = 0;
let clean = 0;

for (const [key, entries] of rawEntries) {
  if (entries.length === 1) {
    const e = entries[0];
    // Per-key display: variant keys store the VARIANT's own form, canonical
    // keys store the canonical (since addKey populated accentedLatin/Greek
    // accordingly). This is what makes "Ιωάννης" stay "Ιωάννης" on lookup
    // instead of collapsing to "Γιάννης".
    dict.set(key, {
      kind: "canonical",
      latin: e.accentedLatin,
      greek: e.accentedGreek,
    });
    clean++;
    continue;
  }

  // Multiple entries claim this key.
  const canonicalEntries = entries.filter(e => e.isCanonical);
  if (canonicalEntries.length === 1) {
    // One canonical wins.
    const e = canonicalEntries[0];
    const g = groups[e.gi];
    dict.set(key, { kind: "canonical", latin: g.canonLatin, greek: g.canonGreek });
    canonicalWins++;
  } else {
    // Ambiguous — store the accented form of the variant itself.
    const e = entries[0];
    dict.set(key, {
      kind: "accent",
      latin: e.accentedLatin,
      greek: e.accentedGreek,
    });
    accentFallbacks++;
  }
}

console.log(`Groups: ${groups.length}`);
console.log(`Unique keys: ${dict.size}`);
console.log(`  Clean (single owner): ${clean}`);
console.log(`  Canonical wins collision: ${canonicalWins}`);
console.log(`  Accent-only (ambiguous): ${accentFallbacks}`);

// Step 4: emit TypeScript.
const tsLines = [
  '// AUTO-GENERATED by scripts/build-greek-names.mjs — do not edit manually.',
  '// Re-run:  node scripts/build-greek-names.mjs',
  '//',
  `// Source: Greek_First_Names_and_Variants.csv (${groups.length} name groups)`,
  `// Keys: ${dict.size} (${clean} clean, ${canonicalWins} canonical-wins, ${accentFallbacks} accent-only)`,
  '',
  'export interface NameEntry {',
  '  /** "canonical" = unambiguous, resolve to the group\'s chosen form.',
  '   *  "accent" = ambiguous variant, just fix tonos/casing. */',
  '  kind: "canonical" | "accent";',
  '  /** Properly-cased Latin form. */',
  '  latin: string;',
  '  /** Properly-cased + accented Greek form. */',
  '  greek: string;',
  '}',
  '',
  'export const NAME_DICT: ReadonlyMap<string, NameEntry> = new Map([',
];

const sortedKeys = Array.from(dict.keys()).sort();
for (const key of sortedKeys) {
  const entry = dict.get(key);
  const kindStr = entry.kind;
  const lat = entry.latin.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const gr = entry.greek.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  tsLines.push(`  ['${key}', { kind: '${kindStr}', latin: '${lat}', greek: '${gr}' }],`);
}

tsLines.push("]);");
tsLines.push("");

writeFileSync(OUT_PATH, tsLines.join("\n"), "utf-8");
console.log(`\nWritten to ${OUT_PATH}`);
