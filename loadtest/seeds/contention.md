# `contention` seed

Same product/category shape as [`thin`](./thin.md), with **one variant
intentionally set to 1 unit of inventory** so multiple k6 VUs racing for it
produce exactly one winner and N-1 losers.

## What this produces (delta vs `thin`)

| Table | Difference from thin |
|---|---|
| `categories` | identical (2 categories) |
| `products` | identical (5 products) |
| `product_variants` | identical (1 per product) |
| `inventory_items` | 4 variants at 100 units (default), **1 variant at 1 unit** |
| `product_categories` | identical |

The contested variant is whichever product matches `CONTESTED_SLUG` in `contention.mjs`. Currently set to `trenaki-xylino` (Ξύλινο Τρενάκι, €24.90).

## Side effect: writes a target file

After seeding, `contention.mjs` writes `loadtest/lib/contention-target.json` with the contested variant's id + slug. The k6 scenario reads this file at init time so the racing target doesn't need to be hard-coded.

```json
{
  "generated_at": "2026-06-14T22:15:00.000Z",
  "contested_product_id": "uuid-here",
  "contested_product_slug": "trenaki-xylino",
  "contested_variant_id": "uuid-here",
  "contested_variant_sku": "LT001-V1",
  "starting_inventory": 1
}
```

This file is gitignored (or should be) since it changes every reseed. The scenario fails fast with a clear error if it's missing.

## Run

```bash
# Always against a fresh local DB
npx supabase db reset --local
npm run seed:contention
```

The seed has a hard guard refusing to run unless `NEXT_PUBLIC_SUPABASE_URL` is `127.0.0.1` or `localhost`.

## Why this seed instead of extending `thin`

Two reasons:
1. **Isolation of intent** — running `seed:thin` should never accidentally produce a contention test fixture, and vice versa. Each seed lives by itself and self-documents what it produces.
2. **Per-test reproducibility** — every contention run starts from the same known starting state, which is essential for assertion-based correctness tests.
