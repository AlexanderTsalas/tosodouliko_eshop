-- =============================================================================
-- Drop the DEFERRED constraint trigger on products that requires every
-- product to have at least one variant.
--
-- WHY: The original migration 20260610000017 created this trigger as
-- DEFERRED INITIALLY DEFERRED, assuming createProduct would do the
-- product INSERT and variants INSERT in a single transaction. At commit
-- time the deferred check would then see the variants and pass.
--
-- That assumption is wrong. createProduct calls supabase-js
-- `.from("products").insert(...)` followed by
-- `.from("product_variants").insert(...)` — two separate PostgREST HTTP
-- requests. PostgREST makes each request its own auto-committed
-- transaction. So:
--
--   1. INSERT INTO products → COMMIT (txn 1)
--   2. DEFERRED trigger fires at COMMIT of txn 1
--   3. Sees variant_count=0 (the variants insert hasn't happened yet)
--   4. Raises check_violation → blocks product creation entirely
--
-- The trigger CANNOT work with PostgREST's request model. To preserve
-- the DB-layer guarantee we'd need an atomic RPC (create_product_with_
-- variants(jsonb, jsonb)) called via `.rpc()` — that's a larger refactor
-- of createProduct that's tracked as a follow-up.
--
-- For now we rely on the application-layer Zod schema check in
-- src/actions/products/createProduct.ts which requires variants.length
-- >= 1 before any DB call. The submit button is gated until the admin
-- has staged at least one variant. Direct SQL inserts that bypass the
-- action are a remote concern given RLS is enforced and only admins
-- have manage:products.
--
-- KEPT: the trigger on product_variants (trg_variants_require_at_least_one)
-- — this one DOES work because DELETE/UPDATE of variants is a single
-- statement and the deferred check fires correctly at commit. It
-- protects against admins accidentally deleting the last variant of
-- a product.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_products_require_variant ON public.products;

-- Update the function comment so future readers understand why only
-- product_variants invokes it now.
COMMENT ON FUNCTION public.ensure_product_has_variant IS
'Deferred constraint trigger that protects against deleting/orphaning the last variant of a product. Fires from product_variants DELETE/UPDATE only — the equivalent trigger on products INSERT was dropped because it could not work with PostgREST''s per-request transaction model (the variants insert lands in a separate transaction that arrives AFTER the product insert commits). Application-layer Zod validation in createProduct enforces variants.length >= 1 instead. See migration 20260611000025 for details.';

NOTIFY pgrst, 'reload schema';
