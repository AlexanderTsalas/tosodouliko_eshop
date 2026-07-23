-- =============================================================================
-- wf-020 — Order history schema (+ order_items)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending',
  currency text NOT NULL DEFAULT 'EUR' REFERENCES public.currencies(code),
  subtotal numeric(10,2) NOT NULL,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  shipping_amount numeric(10,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL,
  shipping_address jsonb,
  billing_address jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'paid', 'fulfilling', 'shipped', 'delivered', 'cancelled', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id
  ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number
  ON public.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON public.orders(created_at DESC);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select_own_or_admin"
  ON public.orders FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission('manage:orders'));
CREATE POLICY "orders_admin_write"
  ON public.orders FOR ALL TO authenticated
  USING (public.has_permission('manage:orders'))
  WITH CHECK (public.has_permission('manage:orders'));

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  product_name text NOT NULL,
  variant_label text,
  sku text,
  quantity integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  total numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id
  ON public.order_items(variant_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items_select_own_or_admin"
  ON public.order_items FOR SELECT TO authenticated
  USING (
    order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid())
    OR public.has_permission('manage:orders')
  );
