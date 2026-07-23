#!/usr/bin/env node
/**
 * Contention seed — same shape as `thin`, but one variant marked "contested"
 * with quantity_available = 1 so multiple k6 VUs racing for it produce
 * exactly ONE winner and N-1 losers.
 *
 * Run:
 *   npx supabase db reset --local
 *   npm run seed:contention
 *
 * After seeding, the scenario reads `loadtest/lib/contention-target.json`
 * (written by THIS script at the end) to know which variant_id to race for.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Hard guard — refuses to run against anything but localhost.
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

// ─── Idempotency check ──────────────────────────────────────────────────────
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

console.log(`→ Seeding contention dataset at ${url}`);

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

// ─── Products (identical to thin) ───────────────────────────────────────────
const productSeeds = [
  { slug: "trenaki-xylino",      name: "Ξύλινο Τρενάκι",    base_price: 24.90, category: "paixnidia" },
  { slug: "kouklospito-mini",    name: "Μίνι Κουκλόσπιτο",  base_price: 49.90, category: "paixnidia" },
  { slug: "puzzle-100-kommatia", name: "Παζλ 100 Κομμάτια", base_price: 12.50, category: "paixnidia" },
  { slug: "vivlio-paramyti",     name: "Βιβλίο Παραμύθι",   base_price:  8.90, category: "vivlia" },
  { slug: "vivlio-zographiki",   name: "Βιβλίο Ζωγραφικής", base_price:  6.50, category: "vivlia" },
];
const CONTESTED_SLUG = "trenaki-xylino"; // change here if you want a different contested product

const productInserts = productSeeds.map((p, i) => ({
  slug: p.slug,
  name: p.name,
  description: `${p.name} — δοκιμαστικό προϊόν contention test.`,
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

// ─── Identify the contested variant ─────────────────────────────────────────
const contestedProduct = products.find((p) => p.slug === CONTESTED_SLUG);
if (!contestedProduct) {
  console.error(`✗ Contested product "${CONTESTED_SLUG}" not found in productSeeds. Bug in seed script.`);
  process.exit(1);
}
const contestedVariant = variants.find((v) => v.product_id === contestedProduct.id);
if (!contestedVariant) {
  console.error(`✗ Variant for "${CONTESTED_SLUG}" not found. Bug in seed script.`);
  process.exit(1);
}

// ─── Inventory ──────────────────────────────────────────────────────────────
// Default 100 per variant (matches thin), but contested = 1.
// The on_variant_inventory_change trigger already created inventory rows
// at (0,0), so we UPSERT to set the values we want.
const inventoryUpserts = variants.map((v) => ({
  variant_id: v.id,
  quantity_available: v.id === contestedVariant.id ? 1 : 100,
  quantity_reserved: 0,
}));
const { error: invErr } = await supabase
  .from("inventory_items")
  .upsert(inventoryUpserts, { onConflict: "variant_id" });
if (invErr) { console.error(`✗ inventory_items: ${invErr.message}`); process.exit(1); }
console.log(`  ✓ ${inventoryUpserts.length} inventory rows (4 × 100, 1 × 1 CONTESTED)`);

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

// ─── Emit the target file the scenario reads ────────────────────────────────
// Stored as JSON so the k6 scenario (which can't import .mjs) can read it
// via SharedArray + JSON.parse(open(...)) at scenario init time.
const targetFile = path.resolve(projectRoot, "loadtest", "lib", "contention-target.json");
writeFileSync(
  targetFile,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      contested_product_id: contestedProduct.id,
      contested_product_slug: contestedProduct.slug,
      contested_variant_id: contestedVariant.id,
      contested_variant_sku: contestedVariant.sku,
      starting_inventory: 1,
    },
    null,
    2
  ) + "\n"
);

console.log(`\n✓ Seed complete.`);
console.log(`  Contested variant: ${contestedProduct.slug} (variant ${contestedVariant.id})`);
console.log(`  Starting stock: 1 unit`);
console.log(`  Target file:  loadtest/lib/contention-target.json`);
console.log(`  Re-seed:  npx supabase db reset --local && npm run seed:contention`);
