-- =============================================================================
-- Enable RLS on the 7 public-schema tables that were missing it.
--
-- Background:
--   Supabase's dashboard flagged 7 tables as "RLS disabled — critical".
--   Audit (see chat history / docs) found all 7 are deliberate, not
--   forgotten — but the access discipline lived at the route/permission
--   layer above the DB, with no defense-in-depth at the schema level.
--
--   Risk that drove this fix: if anyone wires a `createClient()`
--   (RLS-respecting) read of these tables from a non-admin page, RLS-off
--   silently returns rows instead of returning nothing. With RLS enabled
--   + an explicit policy, the schema codifies the access contract.
--
-- Two categories handled here:
--   1) ADMIN-ONLY back-office tables (supplier-chain)
--      → RLS ON + admin-write policy gated by `manage:suppliers`
--      → No SELECT policy for anon — they can't read these
--
--   2) PUBLIC-READ reference tables (product_specifications, vat_rates)
--      → RLS ON + explicit anon-SELECT policy (intent: public read)
--      → Admin-write policy gated by the relevant manage:* permission
--      → Makes the "this table is public" intent explicit in schema
--        instead of "implicit by absence of RLS"
--
-- Behavior change: ZERO. All current code paths continue to work:
--   - Admin actions use createAdminClient() → bypasses RLS entirely
--   - Storefront reads (createClient as anon) of product_specifications
--     + vat_rates → covered by the public-select policy
--   - Admin pages reading vat_rates / suppliers → covered by
--     admin-permission policy
--
-- Belt-and-braces benefit: Supabase's critical flag clears, and any
-- future code path that accidentally uses createClient() on these
-- tables without the right role returns no rows instead of leaking.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Category 1: ADMIN-ONLY supplier-chain tables
-- ─────────────────────────────────────────────────────────────────────

-- suppliers
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suppliers_admin_all" ON public.suppliers;
CREATE POLICY "suppliers_admin_all"
  ON public.suppliers FOR ALL TO authenticated
  USING (public.has_permission('manage:suppliers'))
  WITH CHECK (public.has_permission('manage:suppliers'));

-- supplier_products
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_products_admin_all" ON public.supplier_products;
CREATE POLICY "supplier_products_admin_all"
  ON public.supplier_products FOR ALL TO authenticated
  USING (public.has_permission('manage:suppliers'))
  WITH CHECK (public.has_permission('manage:suppliers'));

-- supply_orders
ALTER TABLE public.supply_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supply_orders_admin_all" ON public.supply_orders;
CREATE POLICY "supply_orders_admin_all"
  ON public.supply_orders FOR ALL TO authenticated
  USING (public.has_permission('manage:suppliers'))
  WITH CHECK (public.has_permission('manage:suppliers'));

-- supply_order_lines
ALTER TABLE public.supply_order_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supply_order_lines_admin_all" ON public.supply_order_lines;
CREATE POLICY "supply_order_lines_admin_all"
  ON public.supply_order_lines FOR ALL TO authenticated
  USING (public.has_permission('manage:suppliers'))
  WITH CHECK (public.has_permission('manage:suppliers'));

-- purchase_lots
ALTER TABLE public.purchase_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "purchase_lots_admin_all" ON public.purchase_lots;
CREATE POLICY "purchase_lots_admin_all"
  ON public.purchase_lots FOR ALL TO authenticated
  USING (public.has_permission('manage:suppliers'))
  WITH CHECK (public.has_permission('manage:suppliers'));

-- ─────────────────────────────────────────────────────────────────────
-- Category 2: PUBLIC-READ reference tables
-- ─────────────────────────────────────────────────────────────────────

-- product_specifications
--   Read: anyone (storefront product detail page renders specs)
--   Write: admins only (gated by manage:products since specs attach to products)
ALTER TABLE public.product_specifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_specifications_public_select" ON public.product_specifications;
CREATE POLICY "product_specifications_public_select"
  ON public.product_specifications FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "product_specifications_admin_write" ON public.product_specifications;
CREATE POLICY "product_specifications_admin_write"
  ON public.product_specifications FOR INSERT
  TO authenticated WITH CHECK (public.has_permission('manage:products'));
DROP POLICY IF EXISTS "product_specifications_admin_update" ON public.product_specifications;
CREATE POLICY "product_specifications_admin_update"
  ON public.product_specifications FOR UPDATE
  TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));
DROP POLICY IF EXISTS "product_specifications_admin_delete" ON public.product_specifications;
CREATE POLICY "product_specifications_admin_delete"
  ON public.product_specifications FOR DELETE
  TO authenticated USING (public.has_permission('manage:products'));

-- vat_rates
--   Read: anyone (kept public so future storefront invoice rendering /
--         tax breakdown UI can read without service-role)
--   Write: admins only
ALTER TABLE public.vat_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vat_rates_public_select" ON public.vat_rates;
CREATE POLICY "vat_rates_public_select"
  ON public.vat_rates FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "vat_rates_admin_write" ON public.vat_rates;
CREATE POLICY "vat_rates_admin_write"
  ON public.vat_rates FOR INSERT
  TO authenticated WITH CHECK (public.has_permission('manage:vat_rates'));
DROP POLICY IF EXISTS "vat_rates_admin_update" ON public.vat_rates;
CREATE POLICY "vat_rates_admin_update"
  ON public.vat_rates FOR UPDATE
  TO authenticated
  USING (public.has_permission('manage:vat_rates'))
  WITH CHECK (public.has_permission('manage:vat_rates'));
DROP POLICY IF EXISTS "vat_rates_admin_delete" ON public.vat_rates;
CREATE POLICY "vat_rates_admin_delete"
  ON public.vat_rates FOR DELETE
  TO authenticated USING (public.has_permission('manage:vat_rates'));

-- Force PostgREST to reload its policy cache so the new rules take
-- effect immediately rather than after a manual restart.
NOTIFY pgrst, 'reload schema';
