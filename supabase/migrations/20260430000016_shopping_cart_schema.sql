-- =============================================================================
-- wf-027 — Shopping cart schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_token text,
  status text NOT NULL DEFAULT 'active',
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL),
  CHECK (status IN ('active', 'abandoned', 'converted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_carts_user_active
  ON public.carts(user_id) WHERE user_id IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_carts_user_id
  ON public.carts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carts_guest_token
  ON public.carts(guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carts_status
  ON public.carts(status);

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carts_select_own"
  ON public.carts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "carts_insert_own"
  ON public.carts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "carts_update_own"
  ON public.carts FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Guest carts: anon access via guest_token only — service role bypasses RLS.

-- ---------------------------------------------------------------------------
-- cart_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity > 0),
  CHECK (unit_price >= 0)
);

COMMENT ON COLUMN public.cart_items.unit_price
IS 'Server-side enforced. Server actions MUST fetch unit_price from product_variants.price (or products.base_price) — never accept from client input. RLS cannot enforce this; it is an application-level invariant.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_variant
  ON public.cart_items(cart_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_product
  ON public.cart_items(cart_id, product_id) WHERE variant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id
  ON public.cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_variant_id
  ON public.cart_items(variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cart_items_select_own"
  ON public.cart_items FOR SELECT TO authenticated
  USING (
    cart_id IN (SELECT id FROM public.carts WHERE user_id = auth.uid())
  );
CREATE POLICY "cart_items_modify_own"
  ON public.cart_items FOR ALL TO authenticated
  USING (
    cart_id IN (SELECT id FROM public.carts WHERE user_id = auth.uid())
  )
  WITH CHECK (
    cart_id IN (SELECT id FROM public.carts WHERE user_id = auth.uid())
  );
