-- =============================================================================
-- wf-030 — Wishlist schema
-- (Adds wishlists parent table — referenced by create_default_wishlist trigger
-- and the wishlists service in the architecture spec.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My Wishlist',
  is_default boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wishlists_user_id
  ON public.wishlists(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlists_user_default
  ON public.wishlists(user_id) WHERE is_default = true;

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wishlists_select_own_or_public"
  ON public.wishlists FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_public = true);
CREATE POLICY "wishlists_modify_own"
  ON public.wishlists FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- wishlist_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id uuid NOT NULL REFERENCES public.wishlists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_items_wishlist_id
  ON public.wishlist_items(wishlist_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_variant_id
  ON public.wishlist_items(variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wishlist_items_modify_own"
  ON public.wishlist_items FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
