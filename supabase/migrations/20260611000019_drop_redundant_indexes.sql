-- =============================================================================
-- Follow-up Phase 5 — Drop indexes covered by existing UNIQUE constraints
-- or by partial indexes added in 20260611000003.
--
-- Background:
--   Postgres creates a backing btree index for every UNIQUE constraint.
--   That backing index serves as a fully-equivalent access path for any
--   query on the constrained column. A second non-unique index over the
--   same column is pure write amplification — every INSERT/UPDATE
--   affecting the column has to update both indexes for no read-side
--   benefit.
--
--   This migration drops eight duplicate / superseded indexes:
--
--     1. idx_orders_order_number          — orders.order_number UNIQUE
--     2. idx_product_variants_sku         — product_variants.sku UNIQUE
--     3. idx_products_slug                — products.slug UNIQUE
--     4. idx_payment_intents_stripe_id    — payment_intents.stripe_payment_intent_id UNIQUE
--     5. idx_inventory_items_variant_id   — inventory_items.variant_id UNIQUE
--     6. idx_attribute_values_attribute_id — leftmost-prefix of
--                                            UNIQUE(attribute_id, value)
--     7. idx_sp_variant                   — leftmost-prefix of
--                                            UNIQUE(variant_id, supplier_id)
--                                            on supplier_products
--     8. idx_orders_carrier               — superseded by
--                                            idx_orders_carrier_slug_partial
--                                            (20260611000003)
--
--   Each drop is reversible via the corresponding CREATE INDEX in
--   earlier migrations; the rollback section at the bottom lists
--   pre-built statements (commented out).
--
-- Validation: After applying, EXPLAIN ANALYZE the four most common
-- queries that previously hit these indexes; the planner should now
-- use the UNIQUE constraint's backing index instead. Sample:
--   EXPLAIN ANALYZE SELECT * FROM orders WHERE order_number = 'TEST';
--   -- Expect: "Index Scan using orders_order_number_key on orders"
-- =============================================================================

-- 1. orders.order_number — UNIQUE-backed
DROP INDEX IF EXISTS public.idx_orders_order_number;

-- 2. product_variants.sku — UNIQUE-backed
DROP INDEX IF EXISTS public.idx_product_variants_sku;

-- 3. products.slug — UNIQUE-backed
DROP INDEX IF EXISTS public.idx_products_slug;

-- 4. payment_intents.stripe_payment_intent_id — UNIQUE-backed
DROP INDEX IF EXISTS public.idx_payment_intents_stripe_id;

-- 5. inventory_items.variant_id — UNIQUE-backed
DROP INDEX IF EXISTS public.idx_inventory_items_variant_id;

-- 6. attribute_values.attribute_id — leftmost-prefix of UNIQUE(attribute_id, value)
DROP INDEX IF EXISTS public.idx_attribute_values_attribute_id;

-- 7. supplier_products.variant_id — leftmost-prefix of UNIQUE(variant_id, supplier_id)
DROP INDEX IF EXISTS public.idx_sp_variant;

-- 8. orders.carrier (legacy enum column) — superseded by partial on carrier_slug
DROP INDEX IF EXISTS public.idx_orders_carrier;

-- =============================================================================
-- Rollback (do NOT uncomment without explicit decision):
-- =============================================================================
-- CREATE INDEX IF NOT EXISTS idx_orders_order_number               ON public.orders(order_number);
-- CREATE INDEX IF NOT EXISTS idx_product_variants_sku              ON public.product_variants(sku);
-- CREATE INDEX IF NOT EXISTS idx_products_slug                     ON public.products(slug);
-- CREATE INDEX IF NOT EXISTS idx_payment_intents_stripe_id         ON public.payment_intents(stripe_payment_intent_id);
-- CREATE INDEX IF NOT EXISTS idx_inventory_items_variant_id        ON public.inventory_items(variant_id);
-- CREATE INDEX IF NOT EXISTS idx_attribute_values_attribute_id     ON public.attribute_values(attribute_id);
-- CREATE INDEX IF NOT EXISTS idx_sp_variant                        ON public.supplier_products(variant_id);
-- CREATE INDEX IF NOT EXISTS idx_orders_carrier                    ON public.orders(carrier);
