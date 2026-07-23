-- =============================================================================
-- wf-024 — Returns & refunds schema (+ return_items)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  refund_amount numeric(10,2),
  admin_notes text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'approved', 'rejected', 'refunded')),
  CHECK (refund_amount IS NULL OR refund_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_return_requests_order_id
  ON public.return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_user_id
  ON public.return_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_status
  ON public.return_requests(status) WHERE status = 'pending';

ALTER TABLE public.return_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_requests_select_own_or_admin"
  ON public.return_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission('manage:returns'));
CREATE POLICY "return_requests_insert_own"
  ON public.return_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "return_requests_admin_update"
  ON public.return_requests FOR UPDATE TO authenticated
  USING (public.has_permission('manage:returns'))
  WITH CHECK (public.has_permission('manage:returns'));

-- ---------------------------------------------------------------------------
-- return_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.return_requests(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  reason text,
  refund_amount numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_return_items_return_id
  ON public.return_items(return_id);

ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_items_select_own_or_admin"
  ON public.return_items FOR SELECT TO authenticated
  USING (
    return_id IN (
      SELECT id FROM public.return_requests WHERE user_id = auth.uid()
    )
    OR public.has_permission('manage:returns')
  );
