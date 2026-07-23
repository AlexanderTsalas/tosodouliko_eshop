-- =============================================================================
-- Phase 8c — Convert update_cart_totals from ROW-level to STATEMENT-level.
--
-- Background:
--   The legacy trigger fires once PER ROW of cart_items changed.
--   Touching 5 cart_items in one statement (e.g. a bulk INSERT during
--   merge_anon_cart) means 5 invocations of update_cart_totals — and
--   each invocation runs two correlated SUM subqueries over the entire
--   cart, producing 5x the work the cart actually requires.
--
--   STATEMENT-level firing executes the trigger ONCE per statement
--   regardless of how many rows were touched, using transition tables
--   (REFERENCING NEW TABLE / OLD TABLE) to enumerate the cart_ids
--   that need recomputing. The recomputation logic is identical;
--   only the firing cadence changes.
--
-- Behavioral notes:
--   - A single-row INSERT/UPDATE/DELETE still fires the trigger once.
--     No semantic change for the common per-action path.
--   - Multi-row mutations (bulk INSERT, DELETE WHERE) now fire ONCE
--     instead of N times. Net: cart-merge actions drop from N rows
--     × 2 SUM queries to 1 × 2 SUM queries per affected cart.
--   - The recomputed values are correct regardless of fire cadence
--     because the SUM reads the current cart_items state which already
--     reflects all the rows in the statement.
--   - Multiple UPDATE/DELETE statements in one transaction still fire
--     once each — STATEMENT-level means "per SQL statement," not
--     "per transaction."
--
-- INSERT, UPDATE, and DELETE each need their own trigger because
-- transition table (NEW TABLE / OLD TABLE) availability differs:
--   - INSERT  → NEW TABLE only
--   - DELETE  → OLD TABLE only
--   - UPDATE  → both
-- =============================================================================

-- Drop the old ROW-level trigger before creating the STATEMENT-level ones.
DROP TRIGGER IF EXISTS on_cart_item_change ON public.cart_items;

-- ──── Helper function (statement-level) ─────────────────────────────────────
-- Accepts a list of cart_ids via the transition tables and recomputes
-- totals for each distinct cart in one UPDATE statement.
CREATE OR REPLACE FUNCTION public.update_cart_totals_stmt_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  WITH touched AS (
    SELECT DISTINCT cart_id FROM new_rows WHERE cart_id IS NOT NULL
  ),
  totals AS (
    SELECT
      ci.cart_id,
      COALESCE(SUM(ci.unit_price * ci.quantity), 0) AS subtotal,
      COALESCE(SUM(ci.quantity), 0)                  AS item_count
    FROM public.cart_items ci
    WHERE ci.cart_id IN (SELECT cart_id FROM touched)
    GROUP BY ci.cart_id
  )
  UPDATE public.carts c
  SET subtotal   = COALESCE(t.subtotal, 0),
      item_count = COALESCE(t.item_count, 0),
      updated_at = now()
  FROM touched
  LEFT JOIN totals t ON t.cart_id = touched.cart_id
  WHERE c.id = touched.cart_id;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cart_totals_stmt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  WITH touched AS (
    SELECT DISTINCT cart_id FROM new_rows WHERE cart_id IS NOT NULL
    UNION
    SELECT DISTINCT cart_id FROM old_rows WHERE cart_id IS NOT NULL
  ),
  totals AS (
    SELECT
      ci.cart_id,
      COALESCE(SUM(ci.unit_price * ci.quantity), 0) AS subtotal,
      COALESCE(SUM(ci.quantity), 0)                  AS item_count
    FROM public.cart_items ci
    WHERE ci.cart_id IN (SELECT cart_id FROM touched)
    GROUP BY ci.cart_id
  )
  UPDATE public.carts c
  SET subtotal   = COALESCE(t.subtotal, 0),
      item_count = COALESCE(t.item_count, 0),
      updated_at = now()
  FROM touched
  LEFT JOIN totals t ON t.cart_id = touched.cart_id
  WHERE c.id = touched.cart_id;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cart_totals_stmt_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  WITH touched AS (
    SELECT DISTINCT cart_id FROM old_rows WHERE cart_id IS NOT NULL
  ),
  totals AS (
    SELECT
      ci.cart_id,
      COALESCE(SUM(ci.unit_price * ci.quantity), 0) AS subtotal,
      COALESCE(SUM(ci.quantity), 0)                  AS item_count
    FROM public.cart_items ci
    WHERE ci.cart_id IN (SELECT cart_id FROM touched)
    GROUP BY ci.cart_id
  )
  UPDATE public.carts c
  SET subtotal   = COALESCE(t.subtotal, 0),
      item_count = COALESCE(t.item_count, 0),
      updated_at = now()
  FROM touched
  LEFT JOIN totals t ON t.cart_id = touched.cart_id
  WHERE c.id = touched.cart_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.update_cart_totals_stmt_insert() IS
'Statement-level trigger: recomputes carts.subtotal + carts.item_count for every distinct cart_id touched by the firing INSERT. Replaces a row-level trigger that ran the recomputation N times per multi-row insert.';

CREATE TRIGGER on_cart_items_change_stmt_insert
AFTER INSERT ON public.cart_items
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.update_cart_totals_stmt_insert();

CREATE TRIGGER on_cart_items_change_stmt_update
AFTER UPDATE ON public.cart_items
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.update_cart_totals_stmt_update();

CREATE TRIGGER on_cart_items_change_stmt_delete
AFTER DELETE ON public.cart_items
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.update_cart_totals_stmt_delete();

NOTIFY pgrst, 'reload schema';
