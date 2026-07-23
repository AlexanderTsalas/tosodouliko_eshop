#!/usr/bin/env node
/**
 * Thin seed script for load-testing the local Supabase stack.
 *
 * Purpose: insert the minimum data needed for storefront browse + cart
 * scenarios to function. Does NOT seed: offers, related products,
 * suppliers, supply orders, custom fields, returns, MFA codes, etc. —
 * those get their own per-scenario seed modules later, as scenarios
 * actually need them.
 *
 *   2 categories
 *   5 products
 *   1 variant per product (single-variant products, no attribute axes)
 *   inventory_items with quantity_available=100 per variant
 *   product_categories links
 *
 * Hard guard: aborts unless NEXT_PUBLIC_SUPABASE_URL points at 127.0.0.1
 * or localhost. Production URLs short-circuit immediately.
 *
 *   Run:  npm run seed:loadtest
 *   Force (overwrite-ish, requires empty tables): npm run seed:loadtest -- --force
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Hard guard ─────────────────────────────────────────────────────────────
// Refuse to talk to anything that isn't the local Supabase stack. This is
// the safety rail against `npm run seed:loadtest` accidentally running with
// remote credentials. Even with .env.localstack the env swap should always
// produce a 127.0.0.1 URL — if not, something upstream is wrong.
if (!url || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|$|\/)/.test(url)) {
  console.error("✗ Refusing to seed.");
  console.error(`  NEXT_PUBLIC_SUPABASE_URL must point at 127.0.0.1 or localhost.`);
  console.error(`  Got: ${url ?? "(unset)"}`);
  console.error(`  Run via: npm run seed:loadtest`);
  process.exit(1);
}
if (!serviceKey) {
  console.error("✗ SUPABASE_SERVICE_ROLE_KEY is unset. Cannot seed.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const force = process.argv.includes("--force");

// ─── Idempotency check ──────────────────────────────────────────────────────
// If the products table already has rows, abort unless --force. The seed
// uses non-upserting INSERTs that would fail on slug/SKU uniqueness anyway —
// this just makes the error message friendlier than "duplicate key value".
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
    console.error(`  Either: npx supabase db reset --local   (clean wipe)`);
    console.error(`  Or:     pass --force to attempt insert anyway (will likely fail on slug conflict).`);
    process.exit(1);
  }
}

console.log(`→ Seeding local stack at ${url}`);

// ─── Categories ─────────────────────────────────────────────────────────────
const categorySeeds = [
  {
    slug: "paixnidia",
    name: "Παιχνίδια",
    description: "Παιχνίδια για όλες τις ηλικίες",
    display_order: 1,
    active: true,
  },
  {
    slug: "vivlia",
    name: "Βιβλία",
    description: "Παιδικά βιβλία και ιστορίες",
    display_order: 2,
    active: true,
  },
];

const { data: categories, error: catErr } = await supabase
  .from("categories")
  .insert(categorySeeds)
  .select("id, slug, name");
if (catErr) {
  console.error(`✗ categories insert failed: ${catErr.message}`);
  process.exit(1);
}
console.log(`  ✓ ${categories.length} categories`);

const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

// ─── Products ───────────────────────────────────────────────────────────────
const productSeeds = [
  { slug: "trenaki-xylino",       name: "Ξύλινο Τρενάκι",        base_price: 24.90, category: "paixnidia" },
  { slug: "kouklospito-mini",     name: "Μίνι Κουκλόσπιτο",       base_price: 49.90, category: "paixnidia" },
  { slug: "puzzle-100-kommatia",  name: "Παζλ 100 Κομμάτια",      base_price: 12.50, category: "paixnidia" },
  { slug: "vivlio-paramyti",      name: "Βιβλίο Παραμύθι",        base_price:  8.90, category: "vivlia" },
  { slug: "vivlio-zographiki",    name: "Βιβλίο Ζωγραφικής",      base_price:  6.50, category: "vivlia" },
];

const productInserts = productSeeds.map((p, i) => ({
  slug: p.slug,
  name: p.name,
  description: `${p.name} — δοκιμαστικό προϊόν load-test.`,
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
if (prodErr) {
  console.error(`✗ products insert failed: ${prodErr.message}`);
  process.exit(1);
}
console.log(`  ✓ ${products.length} products`);

// ─── Variants (1 per product) ───────────────────────────────────────────────
// Single-variant products. attribute_combo=null is acceptable for a
// product with only one variant — the UNIQUE(product_id, combo::text)
// constraint won't conflict because each product has at most one row here.
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
if (varErr) {
  console.error(`✗ product_variants insert failed: ${varErr.message}`);
  process.exit(1);
}
console.log(`  ✓ ${variants.length} variants`);

// ─── Inventory (100 units per variant) ──────────────────────────────────────
// Note: an AFTER INSERT trigger on product_variants
// (`on_variant_inventory_change` → `sync_inventory_from_variant`) already
// auto-creates an inventory_items row with quantity_available=0 for each
// new variant. So we UPSERT here, keying on the UNIQUE(variant_id) constraint,
// to update the auto-created row's quantity instead of conflicting with it.
const inventoryUpserts = variants.map((v) => ({
  variant_id: v.id,
  quantity_available: 100,
  quantity_reserved: 0,
}));

const { error: invErr } = await supabase
  .from("inventory_items")
  .upsert(inventoryUpserts, { onConflict: "variant_id" });
if (invErr) {
  console.error(`✗ inventory_items upsert failed: ${invErr.message}`);
  process.exit(1);
}
console.log(`  ✓ ${inventoryUpserts.length} inventory rows × 100 units (upserted over auto-created rows)`);

// ─── product_categories (M:N link) ──────────────────────────────────────────
const linkInserts = products.map((p) => {
  const seed = productSeeds.find((s) => s.slug === p.slug);
  return {
    product_id: p.id,
    category_id: catBySlug[seed.category].id,
  };
});

const { error: linkErr } = await supabase
  .from("product_categories")
  .insert(linkInserts);
if (linkErr) {
  console.error(`✗ product_categories link failed: ${linkErr.message}`);
  process.exit(1);
}
console.log(`  ✓ ${linkInserts.length} product↔category links`);

console.log(`\n✓ Seed complete.`);
console.log(`  Visit http://localhost:3000 to see products on the storefront.`);
console.log(`  Re-seed: \`npx supabase db reset --local && npm run seed:loadtest\``);
