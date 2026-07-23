# `thin` seed

Smallest viable seed for storefront load tests. **5 products, 2 categories, 1 single-axis-less variant per product, 100 units inventory each.**

## What this produces

| Table | Rows | Notes |
|---|---|---|
| `categories` | 2 | `Παιχνίδια` (paixnidia), `Βιβλία` (vivlia) |
| `products` | 5 | 3 toys, 2 books — Greek names, EUR prices €6.50–€49.90 |
| `product_variants` | 5 | one per product, `attribute_combo = NULL` (no axis matrix) |
| `inventory_items` | 5 | `quantity_available = 100` per variant |
| `product_categories` | 5 | one M:N link per product |

Product slugs (used by scenarios via `loadtest/lib/config.js`):
- `trenaki-xylino`
- `kouklospito-mini`
- `puzzle-100-kommatia`
- `vivlio-paramyti`
- `vivlio-zographiki`

## What's intentionally MISSING

This seed creates only the data needed for **read-path** scenarios (homepage, product listing, product detail, category navigation). Things NOT seeded:

- **Offers / discount codes** — rules table empty
- **Related products** — no associations
- **Multi-variant matrices** — every product is single-variant
- **Custom fields** — no field definitions or values
- **Suppliers / supply orders** — empty
- **Carrier configurations** — only built-in carrier rows from migrations (no provider credentials)
- **Custom delivery methods** — empty
- **Customers / orders** — only the admin user from `npm run admin:create:localstack`

Each follow-up scenario that needs more data gets its own seed module (`mid.mjs`, `with-offers.mjs`, `multi-variant.mjs`, etc.) — composable on top of `thin`, not replacements for it.

## Run

```bash
# Always against a fresh local DB
npx supabase db reset --local
npm run seed:thin
```

The seed has a hard guard refusing to run unless `NEXT_PUBLIC_SUPABASE_URL` is `127.0.0.1` or `localhost` — it cannot accidentally pollute remote Supabase.

## Why so small

Five products on a fresh DB means **Postgres caches everything in shared_buffers, Next.js serves rendered HTML from cache**. This makes `thin` ideal for:

- ✅ Smoke tests (does the pipe work?)
- ✅ Baseline latency measurement (best case)
- ✅ Cheap iteration during scenario development

And *unsuitable* for:

- ❌ Realistic browse load (no working-set pressure)
- ❌ Search performance (no diversity for trigram to chew on)
- ❌ Filter / facet queries (no attribute variation)
- ❌ Cache invalidation behavior (cache always hot)

For those scenarios, use a richer seed once it exists.
