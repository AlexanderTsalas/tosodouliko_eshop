-- =============================================================================
-- wf-009 — Courier integration schema (+ shipment_events)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  courier text NOT NULL,
  tracking_number text,
  tracking_url text,
  status text NOT NULL DEFAULT 'pending',
  label_url text,
  estimated_delivery date,
  shipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'label_created', 'in_transit', 'delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_order_id
  ON public.shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking
  ON public.shipments(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_status
  ON public.shipments(status);

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipments_select_own_or_admin"
  ON public.shipments FOR SELECT TO authenticated
  USING (
    order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid())
    OR public.has_permission('manage:shipments')
  );
CREATE POLICY "shipments_admin_write"
  ON public.shipments FOR ALL TO authenticated
  USING (public.has_permission('manage:shipments'))
  WITH CHECK (public.has_permission('manage:shipments'));

-- ---------------------------------------------------------------------------
-- shipment_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text,
  description text,
  location text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment_id
  ON public.shipment_events(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_events_occurred_at
  ON public.shipment_events(occurred_at DESC);

ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipment_events_select_own_or_admin"
  ON public.shipment_events FOR SELECT TO authenticated
  USING (
    shipment_id IN (
      SELECT s.id FROM public.shipments s
      JOIN public.orders o ON o.id = s.order_id
      WHERE o.user_id = auth.uid()
    )
    OR public.has_permission('manage:shipments')
  );
