-- =============================================================================
-- Product drafts — inline draft creation marker.
--
-- Adds `products.is_draft`, a flag DISTINCT from `active`, so that:
--   1. Inline-created drafts are born active=false (storefront-safe via the
--      existing RLS public-select policy) AND tagged is_draft=true.
--   2. A draft can be told apart from an intentionally-inactive *finished*
--      product — without that distinction an "old inactive product" reaper
--      would delete legitimately-hidden products. The marker makes auto-
--      cleanup of abandoned drafts SAFE.
--   3. "Create Product" finalises a draft by clearing is_draft (it stays
--      active=false until the admin activates it).
--
-- Idempotent + fresh-DB clean: ADD COLUMN IF NOT EXISTS, partial index,
-- DROP/CREATE POLICY.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.is_draft IS
  'TRUE = an inline-created draft never finalised. Born active=false; '
  'excluded from storefront; cleared on "Create Product". Distinct from '
  'active so abandoned drafts can be auto-reaped without touching '
  'intentionally-inactive published products.';

-- Partial index — drives the stale-draft reaper and the admin draft filter.
CREATE INDEX IF NOT EXISTS idx_products_is_draft
  ON public.products(is_draft) WHERE is_draft = true;

-- Harden the public SELECT policy: a draft must NEVER be customer-visible,
-- even if `active` were somehow set true. Backstop on top of the active
-- filter. Admins (manage:products) still see everything.
DROP POLICY IF EXISTS "products_select_public" ON public.products;
CREATE POLICY "products_select_public"
  ON public.products FOR SELECT TO anon, authenticated
  USING (
    (active = true AND is_draft = false)
    OR public.has_permission('manage:products')
  );
