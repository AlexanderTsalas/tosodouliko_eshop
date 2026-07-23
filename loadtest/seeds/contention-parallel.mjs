#!/usr/bin/env node
/**
 * Contention parallel-chains seed — 3 contested variants, 1 unit each.
 *
 * Companion to contention.mjs but marks THREE variants as contested instead
 * of one. Used by the Test 2b scenario (parallel chains) to verify cross-
 * chain isolation: three independent contention chains advance concurrently.
 *
 * Writes loadtest/lib/contention-parallel-target.json with all three
 * contested variants' ids + slugs, in stable order.
 *
 * Run:
 *   npx supabase db reset --local
 *   npm run seed:contention-parallel
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|$|\/)/.test(url)) {
  console.error("✗ Refusing to seed.");
  console.error(`  NEXT_PUBLIC_SUPABASE_URL must point at 127.0.0.1 or localhost.`);
  console.error(`  Got: ${url ?? "(unset)"}`);
  process.exit(1);
}
if (!serviceKey) {
  console.error("✗ SUPABASE_SERVICE_ROLE_KEY is unset.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const force = process.argv.includes("--force");

{
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error(`✗ Couldn't read products: ${error.message}`);
    process.exit(1);
  }
  if (count && count > 0 && !force) {
    console.error(`✗ products table has ${count} rows already.`);
    console.error(`  Run:  npx supabase db reset --local   then re-run.`);
    process.exit(1);
  }
}

console.log(`→ Seeding contention-parallel dataset at ${url}`);

// ─── Categories ─────────────────────────────────────────────────────────────
const categorySeeds = [
  { slug: "paixnidia", name: "Παιχνίδια", description: "Παιχνίδια", display_order: 1, active: true },
  { slug: "vivlia",    name: "Βιβλία",    description: "Βιβλία",    display_order: 2, active: true },
];
const { data: categories, error: catErr } = await supabase
  .from("categories")
  .insert(categorySeeds)
  .select("id, slug");
if (catErr) { console.error(`✗ categories: ${catErr.message}`); process.exit(1); }
console.log(`  ✓ ${categories.length} categories`);
const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

// ─── Products ───────────────────────────────────────────────────────────────
const productSeeds = [
  { slug: "trenaki-xylino",      name: "Ξύλινο Τρενάκι",    base_price: 24.90, category: "paixnidia" },
  { slug: "kouklospito-mini",    name: "Μίνι Κουκλόσπιτο",  base_price: 49.90, category: "paixnidia" },
  { slug: "puzzle-100-kommatia", name: "Παζλ 100 Κομμάτια", base_price: 12.50, category: "paixnidia" },
  { slug: "vivlio-paramyti",     name: "Βιβλίο Παραμύθι",   base_price:  8.90, category: "vivlia" },
  { slug: "vivlio-zographiki",   name: "Βιβλίο Ζωγραφικής", base_price:  6.50, category: "vivlia" },
];

// THREE contested variants — the chains race for these in parallel.
// Choose three from different price points to ensure the test is product-agnostic.
const CONTESTED_SLUGS = [
  "trenaki-xylino",
  "kouklospito-mini",
  "puzzle-100-kommatia",
];

const productInserts = productSeeds.map((p, i) => ({
  slug: p.slug,
  name: p.name,
  description: `${p.name} — δοκιμαστικό προϊόν parallel contention test.`,
  base_price: p.base_price,
  currency: "EUR",
  active: true,
  base_sku: `LT${String(i + 1).padStart(3, "0")}`,
  weight_g: 500,
}));
const { data: products, error: prodErr } = await supabase
  .from("products")
  .insert(productInserts)
  .select("id, slug, base_sku, base_price");
if (prodErr) { console.error(`✗ products: ${prodErr.message}`); process.exit(1); }
console.log(`  ✓ ${products.length} products`);

// ─── Variants ───────────────────────────────────────────────────────────────
const variantInserts = products.map((p) => ({
  product_id: p.id,
  sku: `${p.base_sku}-V1`,
  price: p.base_price,
  is_active: true,
  attribute_combo: null,
}));
const { data: variants, error: varErr } = await supabase
  .from("product_variants")
  .insert(variantInserts)
  .select("id, sku, product_id");
if (varErr) { console.error(`✗ variants: ${varErr.message}`); process.exit(1); }
console.log(`  ✓ ${variants.length} variants`);

// ─── Identify contested variants ────────────────────────────────────────────
const contestedTargets = CONTESTED_SLUGS.map((slug) => {
  const product = products.find((p) => p.slug === slug);
  if (!product) {
    console.error(`✗ Contested product "${slug}" not found. Bug in seed script.`);
    process.exit(1);
  }
  const variant = variants.find((v) => v.product_id === product.id);
  if (!variant) {
    console.error(`✗ Variant for "${slug}" not found. Bug in seed script.`);
    process.exit(1);
  }
  return {
    product_slug: slug,
    product_id: product.id,
    variant_id: variant.id,
    variant_sku: variant.sku,
    starting_inventory: 1,
  };
});

// ─── Inventory: 3 contested at 1 unit, others at 100 ────────────────────────
const contestedVariantIds = new Set(contestedTargets.map((t) => t.variant_id));
const inventoryUpserts = variants.map((v) => ({
  variant_id: v.id,
  quantity_available: contestedVariantIds.has(v.id) ? 1 : 100,
  quantity_reserved: 0,
}));
const { error: invErr } = await supabase
  .from("inventory_items")
  .upsert(inventoryUpserts, { onConflict: "variant_id" });
if (invErr) { console.error(`✗ inventory_items: ${invErr.message}`); process.exit(1); }
console.log(
  `  ✓ ${inventoryUpserts.length} inventory rows (${contestedTargets.length} × 1 CONTESTED, ${variants.length - contestedTargets.length} × 100)`
);

// ─── Product-category links ─────────────────────────────────────────────────
const linkInserts = products.map((p) => {
  const seed = productSeeds.find((s) => s.slug === p.slug);
  return { product_id: p.id, category_id: catBySlug[seed.category].id };
});
const { error: linkErr } = await supabase
  .from("product_categories")
  .insert(linkInserts);
if (linkErr) { console.error(`✗ product_categories: ${linkErr.message}`); process.exit(1); }
console.log(`  ✓ ${linkInserts.length} product↔category links`);

// ─── Emit target file ───────────────────────────────────────────────────────
const targetFile = path.resolve(
  projectRoot,
  "loadtest",
  "lib",
  "contention-parallel-target.json"
);
writeFileSync(
  targetFile,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      contested_count: contestedTargets.length,
      contested_variants: contestedTargets,
    },
    null,
    2
  ) + "\n"
);

console.log(`\n✓ Seed complete.`);
for (const t of contestedTargets) {
  console.log(`  Contested: ${t.product_slug} → variant ${t.variant_id}`);
}
console.log(`  Target file:  loadtest/lib/contention-parallel-target.json`);
