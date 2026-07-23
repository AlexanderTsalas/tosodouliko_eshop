-- =============================================================================
-- Concurrency-safety constraints for supply orders.
--
-- Two race conditions the application code can't prevent on its own:
--
--   1) Two admins clicking "+draft" on the same supplier with no existing
--      draft -> both see "no draft" -> both INSERT -> two drafts per supplier.
--   2) Two admins adding the same variant to the same draft simultaneously ->
--      both pass the dedupe check -> two lines for the same (order, variant).
--
-- This migration first heals any existing duplicates (idempotent maintenance
-- pass), then adds the constraints that prevent them going forward. After this
-- runs, the application can use ON CONFLICT DO NOTHING (.upsert with
-- ignoreDuplicates) instead of a separate fetch-then-insert and trust the DB
-- to arbitrate concurrent writes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Heal: collapse multiple drafts per supplier into the most recent one.
-- Lines from older drafts get moved to the keeper; if the keeper already has
-- the same variant, the older line is dropped (oldest-wins for the keeper).
-- Empty older drafts are deleted afterwards.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  keeper_id uuid;
  loser_ids uuid[];
BEGIN
  FOR r IN
    SELECT
      supplier_id,
      (array_agg(id ORDER BY created_at DESC))[1]    AS keeper,
      (array_agg(id ORDER BY created_at DESC))[2:]   AS losers
    FROM public.supply_orders
    WHERE status = 'draft'
    GROUP BY supplier_id
    HAVING COUNT(*) > 1
  LOOP
    keeper_id := r.keeper;
    loser_ids := r.losers;

    -- Move lines from loser drafts to keeper, only where the keeper doesn't
    -- already have that variant. The "dup variants" remaining on losers will
    -- be deleted with the loser drafts (ON DELETE CASCADE on supply_order_lines).
    UPDATE public.supply_order_lines sol_old
       SET supply_order_id = keeper_id
     WHERE sol_old.supply_order_id = ANY(loser_ids)
       AND NOT EXISTS (
         SELECT 1
           FROM public.supply_order_lines sol_new
          WHERE sol_new.supply_order_id = keeper_id
            AND sol_new.variant_id      = sol_old.variant_id
       );

    -- Drop the loser drafts (cascades to any remaining duplicate lines).
    DELETE FROM public.supply_orders
     WHERE id = ANY(loser_ids);
  END LOOP;
END$$;

-- -----------------------------------------------------------------------------
-- Heal: collapse duplicate (supply_order_id, variant_id) lines within a draft.
-- Defensive — the consolidation above should have prevented any, but a
-- concurrent INSERT could still have produced one in the past. Keep the oldest.
-- -----------------------------------------------------------------------------
DELETE FROM public.supply_order_lines
 WHERE id IN (
   SELECT id
     FROM (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY supply_order_id, variant_id
           ORDER BY created_at ASC
         ) AS rn
       FROM public.supply_order_lines
     ) t
    WHERE rn > 1
 );

-- -----------------------------------------------------------------------------
-- Constraints — prevent the races at the DB level.
-- -----------------------------------------------------------------------------

-- One open draft per supplier.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_supply_orders_one_draft_per_supplier
  ON public.supply_orders(supplier_id) WHERE status = 'draft';

-- A variant appears at most once per supply order.
ALTER TABLE public.supply_order_lines
  DROP CONSTRAINT IF EXISTS supply_order_lines_order_variant_unique;
ALTER TABLE public.supply_order_lines
  ADD CONSTRAINT supply_order_lines_order_variant_unique
  UNIQUE (supply_order_id, variant_id);
