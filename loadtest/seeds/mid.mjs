#!/usr/bin/env node
/**
 * `mid` — realistic mid-scale seed for the Phase B mixed-workload tests.
 *
 * Produces:
 *   - 5 categories (3 top-level + 2 child for hierarchy)
 *   - 4 attributes (color + size for variant axes; material + age for specs)
 *   - 5 color values + 5 size values + 5 material values + 5 age-range values
 *   - 100 products spread across the 5 top-level categories
 *   - 1000 product variants — 10 per product, 2 colors × 5 sizes matrix
 *   - 1000 inventory_items (most at 100 units; ~10 at low-stock for contention)
 *   - 100-200 product_categories links (some products in multiple categories)
 *   - 1-2 specifications per product (~150 total)
 *   - 1 custom field bound to ~20 products (gift message field)
 *   - 5 manual-pick related-products associations (toys, books cross-link)
 *
 * Deferred to a follow-up seed:
 *   - Offers + rules + codes (~5 offers) — separate scope, complex schema.
 *
 * Writes loadtest/lib/mid-target.json with summary of seeded entities.
 *
 * Hard guard: aborts unless NEXT_PUBLIC_SUPABASE_URL is loopback.
 *
 * Run:
 *   npx supabase db reset --local
 *   npm run seed:mid
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

console.log(`→ Seeding mid dataset at ${url}`);

/* ─── Phase 1: Categories ─────────────────────────────────────────────── */
//
// 3 top-level + 2 children. Tests parent_id resolution and hierarchical nav.

const topCategories = [
  { slug: "paixnidia",      name: "Παιχνίδια",     description: "Παιχνίδια για όλες τις ηλικίες", display_order: 1 },
  { slug: "vivlia",         name: "Βιβλία",        description: "Παιδικά βιβλία",                 display_order: 2 },
  { slug: "rouxa",          name: "Ρούχα",         description: "Παιδικά ρούχα",                  display_order: 3 },
];
const { data: topCats, error: tcErr } = await supabase
  .from("categories")
  .insert(topCategories.map((c) => ({ ...c, active: true })))
  .select("id, slug");
if (tcErr) { console.error(`✗ top categories: ${tcErr.message}`); process.exit(1); }
const catBySlug = Object.fromEntries(topCats.map((c) => [c.slug, c]));

const childCategories = [
  { slug: "epitrapezia",    name: "Επιτραπέζια",   description: "Επιτραπέζια παιχνίδια",          display_order: 1, parent_id: catBySlug.paixnidia.id },
  { slug: "paramythia",     name: "Παραμύθια",     description: "Παιδικά παραμύθια",              display_order: 1, parent_id: catBySlug.vivlia.id },
];
const { data: childCats, error: ccErr } = await supabase
  .from("categories")
  .insert(childCategories.map((c) => ({ ...c, active: true })))
  .select("id, slug");
if (ccErr) { console.error(`✗ child categories: ${ccErr.message}`); process.exit(1); }
for (const c of childCats) catBySlug[c.slug] = c;

console.log(`  ✓ ${topCats.length + childCats.length} categories (3 top + 2 child)`);

/* ─── Phase 2: Attributes + attribute_values ──────────────────────────── */
//
// Two attributes used as variant axes (color, size).
// Two attributes used as product specifications (material, age range).
// All four share the same `attributes` registry (per the spec design).

const attributesSeed = [
  { slug: "color",    name: "Χρώμα",   type: "select" },
  { slug: "size",     name: "Μέγεθος", type: "select" },
  { slug: "material", name: "Υλικό",   type: "select" },
  { slug: "age",      name: "Ηλικία",  type: "select" },
];
const { data: attributes, error: attrErr } = await supabase
  .from("attributes")
  .insert(attributesSeed)
  .select("id, slug");
if (attrErr) { console.error(`✗ attributes: ${attrErr.message}`); process.exit(1); }
const attrBySlug = Object.fromEntries(attributes.map((a) => [a.slug, a]));
console.log(`  ✓ ${attributes.length} attributes`);

// Values. NOTE: slug is NOT NULL (per migration 20260531000002).
const valueSeeds = [
  // color
  { attribute_slug: "color", slug: "red",    value: "Κόκκινο", display_order: 1 },
  { attribute_slug: "color", slug: "blue",   value: "Μπλε",    display_order: 2 },
  { attribute_slug: "color", slug: "green",  value: "Πράσινο", display_order: 3 },
  { attribute_slug: "color", slug: "yellow", value: "Κίτρινο", display_order: 4 },
  { attribute_slug: "color", slug: "black",  value: "Μαύρο",   display_order: 5 },
  // size
  { attribute_slug: "size", slug: "xs", value: "XS", display_order: 1 },
  { attribute_slug: "size", slug: "s",  value: "S",  display_order: 2 },
  { attribute_slug: "size", slug: "m",  value: "M",  display_order: 3 },
  { attribute_slug: "size", slug: "l",  value: "L",  display_order: 4 },
  { attribute_slug: "size", slug: "xl", value: "XL", display_order: 5 },
  // material
  { attribute_slug: "material", slug: "wood",    value: "Ξύλο",    display_order: 1 },
  { attribute_slug: "material", slug: "plastic", value: "Πλαστικό", display_order: 2 },
  { attribute_slug: "material", slug: "fabric",  value: "Ύφασμα",  display_order: 3 },
  { attribute_slug: "material", slug: "metal",   value: "Μέταλλο",  display_order: 4 },
  { attribute_slug: "material", slug: "paper",   value: "Χαρτί",   display_order: 5 },
  // age
  { attribute_slug: "age", slug: "0-2",  value: "0-2 ετών",  display_order: 1 },
  { attribute_slug: "age", slug: "3-5",  value: "3-5 ετών",  display_order: 2 },
  { attribute_slug: "age", slug: "6-8",  value: "6-8 ετών",  display_order: 3 },
  { attribute_slug: "age", slug: "9-12", value: "9-12 ετών", display_order: 4 },
  { attribute_slug: "age", slug: "12+",  value: "12+ ετών",  display_order: 5 },
];
const valueInserts = valueSeeds.map((v) => ({
  attribute_id: attrBySlug[v.attribute_slug].id,
  slug: v.slug,
  value: v.value,
  display_order: v.display_order,
}));
const { data: values, error: vErr } = await supabase
  .from("attribute_values")
  .insert(valueInserts)
  .select("id, attribute_id, slug, value");
if (vErr) { console.error(`✗ attribute_values: ${vErr.message}`); process.exit(1); }

// Group values by attribute slug for downstream lookup.
const valuesByAttr = {};
for (const v of values) {
  const attrSlug = attributesSeed.find((a) => a.slug && attrBySlug[a.slug].id === v.attribute_id).slug;
  if (!valuesByAttr[attrSlug]) valuesByAttr[attrSlug] = [];
  valuesByAttr[attrSlug].push(v);
}
console.log(`  ✓ ${values.length} attribute_values (5 colors, 5 sizes, 5 materials, 5 ages)`);

/* ─── Phase 3: Products ───────────────────────────────────────────────── */
//
// 100 products distributed across top-level categories. Greek names from
// templates × adjectives for variety. SKU prefix is deterministic per product.

const productTemplates = [
  // (slug-prefix, name, top_category, price_range)
  { slug: "trenaki",     name: "Ξύλινο Τρενάκι",       cat: "paixnidia",  price: 24.90 },
  { slug: "kouklospito", name: "Κουκλόσπιτο",          cat: "paixnidia",  price: 49.90 },
  { slug: "puzzle",      name: "Παζλ",                 cat: "paixnidia",  price: 12.50 },
  { slug: "kuvoi",       name: "Κύβοι Δομικά",         cat: "paixnidia",  price: 18.90 },
  { slug: "autokinitaki",name: "Αυτοκινητάκι",         cat: "paixnidia",  price: 9.90 },
  { slug: "loutrina",    name: "Λούτρινο",             cat: "paixnidia",  price: 14.90 },
  { slug: "mpalakia",    name: "Μπαλάκια",             cat: "paixnidia",  price: 6.90 },
  { slug: "trampolino",  name: "Τραμπολίνο",           cat: "paixnidia",  price: 79.90 },
  { slug: "stefanaki",   name: "Στεφανάκι",            cat: "paixnidia",  price: 4.90 },
  { slug: "doravra",     name: "Δώρα Βρεφικά",         cat: "paixnidia",  price: 29.90 },
  // books
  { slug: "vivlio-paramyti",  name: "Βιβλίο Παραμύθι",   cat: "vivlia", price: 8.90 },
  { slug: "vivlio-zographi",  name: "Βιβλίο Ζωγραφικής", cat: "vivlia", price: 6.50 },
  { slug: "vivlio-historia",  name: "Ιστορικό Βιβλίο",   cat: "vivlia", price: 11.50 },
  { slug: "vivlio-poiisis",   name: "Βιβλίο Ποίησης",    cat: "vivlia", price: 7.90 },
  { slug: "vivlio-mathisis",  name: "Εκπαιδευτικό",      cat: "vivlia", price: 13.90 },
  // clothing
  { slug: "blouza",     name: "Παιδική Μπλούζα",    cat: "rouxa", price: 19.90 },
  { slug: "panteloni",  name: "Παιδικό Παντελόνι",  cat: "rouxa", price: 24.90 },
  { slug: "foustani",   name: "Φουστάνι",           cat: "rouxa", price: 32.90 },
  { slug: "kalsesakia", name: "Κάλτσες",            cat: "rouxa", price: 5.90 },
  { slug: "kaskol",     name: "Κασκόλ",             cat: "rouxa", price: 9.90 },
];

// Build 100 product seeds by cycling templates with a numeric suffix.
const productSeeds = [];
for (let i = 0; i < 100; i++) {
  const tpl = productTemplates[i % productTemplates.length];
  const num = Math.floor(i / productTemplates.length) + 1;
  productSeeds.push({
    slug: `${tpl.slug}-${i + 1}`,
    name: `${tpl.name} Νο ${num}`,
    description: `${tpl.name} — δοκιμαστικό προϊόν #${i + 1}`,
    base_price: tpl.price + (i % 7) * 0.5, // tiny variation
    category_slug: tpl.cat,
    base_sku: `MID${String(i + 1).padStart(3, "0")}`,
  });
}

const productInserts = productSeeds.map((p) => ({
  slug: p.slug,
  name: p.name,
  description: p.description,
  base_price: p.base_price,
  currency: "EUR",
  active: true,
  base_sku: p.base_sku,
  weight_g: 500,
}));

// Batch insert. 100 products fits in one round-trip easily.
const { data: products, error: pErr } = await supabase
  .from("products")
  .insert(productInserts)
  .select("id, slug, base_sku, base_price");
if (pErr) { console.error(`✗ products: ${pErr.message}`); process.exit(1); }
console.log(`  ✓ ${products.length} products`);

const productBySlug = Object.fromEntries(products.map((p) => [p.slug, p]));

/* ─── Phase 4: Product variants (multi-axis matrix) ───────────────────── */
//
// Each product gets 10 variants = 2 specific colors × all 5 sizes.
// attribute_combo = { color: <uuid>, size: <uuid> } per spec.
// All 10 variants of one product share the same axis keys (matrix-shape
// trigger enforces this).
//
// Color assignment cycles deterministically: product 1 gets red+blue,
// product 2 gets green+yellow, product 3 gets red+green, etc.

const colorPairs = [
  ["red",    "blue"],
  ["green",  "yellow"],
  ["red",    "green"],
  ["blue",   "black"],
  ["yellow", "black"],
  ["red",    "yellow"],
  ["blue",   "green"],
  ["red",    "black"],
];

const variantInserts = [];
const variantMeta = []; // parallel to variantInserts: { product_id, color_slug, size_slug }
for (let i = 0; i < products.length; i++) {
  const product = products[i];
  const seed = productSeeds[i];
  const [colorASlug, colorBSlug] = colorPairs[i % colorPairs.length];
  const colorAVal = valuesByAttr.color.find((v) => v.slug === colorASlug);
  const colorBVal = valuesByAttr.color.find((v) => v.slug === colorBSlug);
  for (const colorVal of [colorAVal, colorBVal]) {
    for (const sizeVal of valuesByAttr.size) {
      variantInserts.push({
        product_id: product.id,
        sku: `${seed.base_sku}-${colorVal.slug}-${sizeVal.slug}`.toUpperCase(),
        price: Number(product.base_price),
        is_active: true,
        attribute_combo: { color: colorVal.id, size: sizeVal.id },
      });
      variantMeta.push({
        product_id: product.id,
        product_slug: product.slug,
        color_slug: colorVal.slug,
        size_slug: sizeVal.slug,
      });
    }
  }
}

// Insert in chunks of 100 to stay polite to PostgREST. Each insert returns
// the variants in INSERTION ORDER (PostgreSQL guarantee for single-statement
// INSERT … RETURNING), so we can match against variantMeta by index.
const variantsRows = [];
const CHUNK = 100;
for (let i = 0; i < variantInserts.length; i += CHUNK) {
  const chunk = variantInserts.slice(i, i + CHUNK);
  const { data, error } = await supabase
    .from("product_variants")
    .insert(chunk)
    .select("id, sku, product_id");
  if (error) {
    console.error(`✗ variants chunk ${i}: ${error.message}`);
    process.exit(1);
  }
  variantsRows.push(...data);
}
console.log(`  ✓ ${variantsRows.length} variants (2 colors × 5 sizes per product)`);

/* ─── Phase 5: Inventory (mix of stock levels) ─────────────────────────── */
//
// Default 100 units per variant. About 1% (10 variants) get low stock (1-3)
// so contention scenarios have natural targets in the catalog.
// Use UPSERT because the on_variant_inventory_change trigger already
// created rows at (0, 0).

const inventoryUpserts = [];
const lowStockCount = 10;
for (let i = 0; i < variantsRows.length; i++) {
  const v = variantsRows[i];
  // Deterministically choose ~lowStockCount variants spread across products
  // for contention realism. Picking every Nth variant ensures they're not
  // all on the same product.
  const isLowStock = i % Math.floor(variantsRows.length / lowStockCount) === 0;
  inventoryUpserts.push({
    variant_id: v.id,
    quantity_available: isLowStock ? 1 + (i % 3) : 100,
    quantity_reserved: 0,
  });
}
// Chunk again for safety.
for (let i = 0; i < inventoryUpserts.length; i += CHUNK) {
  const chunk = inventoryUpserts.slice(i, i + CHUNK);
  const { error } = await supabase
    .from("inventory_items")
    .upsert(chunk, { onConflict: "variant_id" });
  if (error) {
    console.error(`✗ inventory chunk ${i}: ${error.message}`);
    process.exit(1);
  }
}
console.log(
  `  ✓ ${inventoryUpserts.length} inventory rows (${inventoryUpserts.length - lowStockCount} at 100, ${lowStockCount} at low stock)`
);

/* ─── Phase 6: product_categories (M:N) ───────────────────────────────── */
//
// Each product → its primary category. Some products also in a secondary
// (child) category. ~20% double-link for the realism the plan calls for.

const productCategoryLinks = [];
for (let i = 0; i < products.length; i++) {
  const seed = productSeeds[i];
  const primaryCatId = catBySlug[seed.category_slug].id;
  productCategoryLinks.push({
    product_id: products[i].id,
    category_id: primaryCatId,
  });
  // ~20% also linked to a relevant child category.
  if (i % 5 === 0) {
    const childSlug = seed.category_slug === "paixnidia" ? "epitrapezia"
                    : seed.category_slug === "vivlia"   ? "paramythia"
                    : null;
    if (childSlug && catBySlug[childSlug]) {
      productCategoryLinks.push({
        product_id: products[i].id,
        category_id: catBySlug[childSlug].id,
      });
    }
  }
}
for (let i = 0; i < productCategoryLinks.length; i += CHUNK) {
  const chunk = productCategoryLinks.slice(i, i + CHUNK);
  const { error } = await supabase
    .from("product_categories")
    .insert(chunk);
  if (error) {
    console.error(`✗ product_categories chunk ${i}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`  ✓ ${productCategoryLinks.length} product↔category links`);

/* ─── Phase 7: product_specifications ─────────────────────────────────── */
//
// Each product gets 1-2 specs. Material spec for everyone (deterministic
// pick from the 5 materials). Age spec for ~80% of products.

const specInserts = [];
for (let i = 0; i < products.length; i++) {
  const product = products[i];
  // Material spec for every product
  const materialVal = valuesByAttr.material[i % 5];
  specInserts.push({
    product_id: product.id,
    attribute_id: attrBySlug.material.id,
    value: materialVal.value,
    display_order: 1,
  });
  // Age spec for ~80% of products
  if (i % 5 !== 0) {
    const ageVal = valuesByAttr.age[(i + 1) % 5];
    specInserts.push({
      product_id: product.id,
      attribute_id: attrBySlug.age.id,
      value: ageVal.value,
      display_order: 2,
    });
  }
}
for (let i = 0; i < specInserts.length; i += CHUNK) {
  const chunk = specInserts.slice(i, i + CHUNK);
  const { error } = await supabase
    .from("product_specifications")
    .insert(chunk);
  if (error) {
    console.error(`✗ product_specifications chunk ${i}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`  ✓ ${specInserts.length} product specifications`);

/* ─── Phase 8: custom_fields + bindings (minimal) ─────────────────────── */
//
// One gift-message field bound to ~20% of products. Tests the
// custom_field_bindings.scope='product' resolution path on the storefront.

const giftMessageFieldData = {
  key: "gift_message",
  label_translations: { el: "Μήνυμα Δώρου", en: "Gift Message" },
  data_type: "text",
  required_default: false,
  visible: true,
  per_unit: false,
  validation: { maxLength: 200 },
  edit_policy: "admin_until_dispatch",
};
const { data: giftField, error: gfErr } = await supabase
  .from("custom_fields")
  .insert(giftMessageFieldData)
  .select("id, key")
  .single();
if (gfErr) { console.error(`✗ custom_fields: ${gfErr.message}`); process.exit(1); }

// Bind to every 5th product (~20%).
const customBindingInserts = [];
for (let i = 0; i < products.length; i++) {
  if (i % 5 !== 0) continue;
  customBindingInserts.push({
    field_id: giftField.id,
    group_id: null,
    scope_kind: "product",
    scope_resource_id: products[i].id,
    active: true,
    override_required: null,
  });
}
const { error: bindErr } = await supabase
  .from("custom_field_bindings")
  .insert(customBindingInserts);
if (bindErr) { console.error(`✗ custom_field_bindings: ${bindErr.message}`); process.exit(1); }
console.log(`  ✓ 1 custom field + ${customBindingInserts.length} bindings`);

/* ─── Phase 9: related_products (minimal) ─────────────────────────────── */
//
// 5 manual-pick associations cross-linking toys to other toys + books to
// other books. Tests the manual-strategy resolver path. Rule-based
// associations deferred — they need filter_groups + filter_conditions and
// add complexity without much extra test value at this stage.

// NOTE: the original related_products_associations migration had a
// `priority` column. A later migration (20260613000002) dropped it and
// replaced it with `display_order` (1=topmost, sort ASC) + `bidirectional`
// boolean. The seed below uses the current schema, not the original.
const associationInserts = [
  {
    name: "Σας προτείνουμε επίσης",
    message_title_translations: { el: "Σας προτείνουμε επίσης", en: "You may also like" },
    active: true,
    display_order: 1,
    bidirectional: false,
    selection_strategy: "manual",
    max_results: 4,
    card_granularity: "product",
  },
  {
    name: "Επιτραπέζια συμπληρωματικά",
    message_title_translations: { el: "Επιτραπέζια συμπληρωματικά", en: "Other table games" },
    active: true,
    display_order: 2,
    bidirectional: false,
    selection_strategy: "manual",
    max_results: 6,
    card_granularity: "product",
  },
];
const { data: assocs, error: aErr } = await supabase
  .from("related_products_associations")
  .insert(associationInserts)
  .select("id, name");
if (aErr) { console.error(`✗ associations: ${aErr.message}`); process.exit(1); }

// For each association, manual-pick 5-6 products to recommend.
const manualPickInserts = [];
for (let aIdx = 0; aIdx < assocs.length; aIdx++) {
  const start = aIdx * 7;
  for (let j = 0; j < 5; j++) {
    const pIdx = (start + j) % products.length;
    manualPickInserts.push({
      association_id: assocs[aIdx].id,
      product_id: products[pIdx].id,
      sort_order: j,
    });
  }
}
const { error: mpErr } = await supabase
  .from("related_products_manual_picks")
  .insert(manualPickInserts);
if (mpErr) { console.error(`✗ manual_picks: ${mpErr.message}`); process.exit(1); }
console.log(`  ✓ ${assocs.length} related-products associations + ${manualPickInserts.length} manual picks`);

/* ─── Emit target file ────────────────────────────────────────────────── */

// Low-stock variants are useful for contention scenarios — surface them.
const lowStockVariantIds = [];
for (let i = 0; i < inventoryUpserts.length; i++) {
  if (inventoryUpserts[i].quantity_available <= 3) {
    lowStockVariantIds.push({
      variant_id: variantsRows[i].id,
      sku: variantsRows[i].sku,
      starting_inventory: inventoryUpserts[i].quantity_available,
    });
  }
}

const targetFile = path.resolve(
  projectRoot,
  "loadtest",
  "lib",
  "mid-target.json"
);
writeFileSync(
  targetFile,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      counts: {
        categories: topCats.length + childCats.length,
        attributes: attributes.length,
        attribute_values: values.length,
        products: products.length,
        variants: variantsRows.length,
        inventory_items: inventoryUpserts.length,
        product_categories: productCategoryLinks.length,
        specifications: specInserts.length,
        custom_field_bindings: customBindingInserts.length,
        related_associations: assocs.length,
      },
      // Slugs the scenario can use directly for navigating to category pages.
      category_slugs: Object.keys(catBySlug),
      // Product slugs available for product-detail page hits. Sample a few
      // up-front for the scenario to pick from without re-querying.
      sample_product_slugs: products.slice(0, 20).map((p) => p.slug),
      // Low-stock variants for contention-mixed scenarios. Each entry has
      // its starting inventory so the scenario knows how aggressively to
      // race for it.
      low_stock_variants: lowStockVariantIds,
    },
    null,
    2
  ) + "\n"
);

console.log(`\n✓ Seed complete.`);
console.log(`  ${products.length} products × ~${variantsRows.length / products.length} variants each = ${variantsRows.length} variants total`);
console.log(`  ${lowStockVariantIds.length} variants seeded at low stock for contention scenarios`);
console.log(`  Target file: loadtest/lib/mid-target.json`);
