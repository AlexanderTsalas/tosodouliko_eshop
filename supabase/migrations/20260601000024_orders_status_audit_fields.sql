-- =============================================================================
-- Phase 2 of courier-integration-design.md — Status vocabulary expansion
--
-- Audit columns that travel alongside the unified fulfillment_status. The
-- unified status (StatusCode in src/config/status-vocabulary.ts) is what
-- customers see and reports filter by; these columns preserve the carrier-
-- native detail for admin diagnostics, tracking-timeline display, and
-- attribution.
--
--   carrier_raw_status        — the native code the carrier reported
--                               (Geniki: 'C_EA_AP', BoxNow: 'in-final-
--                               destination', ACS: composite like '4_ΑΣ1').
--                               Survives the mapping into fulfillment_status
--                               so a Geniki "C_EA_AP refused" doesn't get
--                               flattened to a generic "delivery_attempted".
--
--   carrier_status_label      — human-readable from the carrier, in the
--                               carrier's language ("Shipment Delivered",
--                               "Απόρριψη παραλαβής"). Admin sees this
--                               as a sub-line under the unified status.
--
--   carrier_status_updated_at — when the carrier last reported a change.
--                               Drives "last carrier update X minutes ago"
--                               in the admin and supports stale-status
--                               warnings.
--
--   status_set_by             — 'api' or 'merchant'. Tells the admin
--                               whether the current status came from an
--                               automated carrier tracking fetch or from
--                               manual entry. Prevents the surprise of
--                               "the system advanced something I thought
--                               I controlled."
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS carrier_raw_status        text,
  ADD COLUMN IF NOT EXISTS carrier_status_label      text,
  ADD COLUMN IF NOT EXISTS carrier_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_set_by             text;

-- CHECK constraint as a separate statement so re-runs don't fail when the
-- column already exists.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_set_by_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_set_by_check
  CHECK (status_set_by IS NULL OR status_set_by IN ('api', 'merchant'));

COMMENT ON COLUMN public.orders.carrier_raw_status IS
  'Native status code from the carrier (e.g., Geniki C_EA_AP, BoxNow in-final-destination, ACS composite). Preserves granularity that gets flattened when mapped to fulfillment_status.';
COMMENT ON COLUMN public.orders.carrier_status_label IS
  'Human-readable status from the carrier, in the carrier''s own language. Shown to admins as detail beneath the unified status.';
COMMENT ON COLUMN public.orders.carrier_status_updated_at IS
  'When the carrier last reported a status change for this order. Null = no carrier update received yet (manual workflow or pre-handoff).';
COMMENT ON COLUMN public.orders.status_set_by IS
  '''api'' if the current fulfillment_status came from an automated carrier-tracking fetch; ''merchant'' if set manually via admin UI. Null on legacy rows pre-Phase 2.';
