-- =============================================================================
-- Persist the base SKU on products so axis-extend operations
-- (addAxisValueToProduct, addAxisToProduct) can derive new variant SKUs
-- from the admin's original prefix instead of falling back to the product
-- slug, which produces different-looking SKUs after the fact.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS base_sku text;

COMMENT ON COLUMN public.products.base_sku IS
  'Admin-chosen SKU prefix used when generating per-variant SKUs. NULL falls back to slugify(slug) at variant-creation time.';
