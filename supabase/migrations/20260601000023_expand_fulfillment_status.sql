-- =============================================================================
-- Phase 2 of courier-integration-design.md — Status vocabulary expansion
--
-- Adds the 14 new shared status codes to the order_fulfillment_status enum.
-- The existing values (draft, pending, confirmed, preparing, shipped,
-- ready_for_pickup, delivered, picked_up, cancelled) are kept for back-compat
-- with existing orders and code paths; new code should prefer the codes from
-- src/config/status-vocabulary.ts.
--
-- Conceptual mapping from legacy to new vocabulary:
--   shipped          ↔ in_transit (legacy was coarser)
--   ready_for_pickup ↔ arrived_at_pickup (semantically equivalent)
--   picked_up        ↔ collected (semantically equivalent)
--
-- A later phase can rename / drop the legacy values once all consumers have
-- been migrated. Postgres doesn't have ALTER TYPE RENAME VALUE in stable
-- versions (16+), so the migration path is: backfill orders with the new
-- code, update transitionOrderStatus.ts to drop legacy from the next-state
-- graph, then in a separate transaction drop the legacy values.
--
-- ALTER TYPE ADD VALUE is safe inside a transaction in PG12+ but the new
-- values can't be referenced in the same transaction (we only add them here;
-- callers use them from the next request onward).
-- =============================================================================

ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'label_created';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'awaiting_carrier';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'in_transit';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'out_for_delivery';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'arrived_at_pickup';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'collected';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'delivery_attempted_absent';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'delivery_attempted_refused';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'delivery_attempted_wrong_address';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'delivery_attempted_damaged';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'returning';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'returned';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'lost';
