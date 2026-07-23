-- =============================================================================
-- Fix two bugs in commit_order_with_lines that together broke every
-- storefront checkout submission since the function was deployed on
-- 2026-06-10.
--
-- A live probe against the remote DB on 2026-06-13 confirmed: zero rows
-- have ever made it into public.orders via this RPC. The function has
-- been raising SQLSTATE 42702 on every call.
--
-- -----------------------------------------------------------------------------
-- Bug 1 — column reference "order_number" is ambiguous (SQLSTATE 42702)
-- -----------------------------------------------------------------------------
-- The function signature `RETURNS TABLE(order_id uuid, order_number text)`
-- implicitly binds `order_id` and `order_number` as PL/pgSQL output
-- variables for the entire function body. The body then does
--
--     INSERT INTO public.orders
--     SELECT * FROM jsonb_populate_record(NULL::public.orders, p_order)
--     RETURNING id, order_number INTO v_order_id, v_order_number;
--
-- where `order_number` could refer to either the OUT-parameter or the
-- column being returned by the INSERT. PL/pgSQL refuses to guess and
-- raises 42702. The transaction rolls back, the customer sees the
-- SQLSTATE message on the checkout page, and the JS caller releases the
-- inventory reservations it had just acquired.
--
-- Fix: add `#variable_conflict use_column`. This per-function directive
-- tells PL/pgSQL to prefer the column reference whenever a name could
-- mean either a column or a variable. The RETURNING clause then resolves
-- to public.orders.order_number unambiguously. Assignment targets after
-- INTO (v_order_id, v_order_number) are unambiguous on their own because
-- their names differ from any column.
--
-- -----------------------------------------------------------------------------
-- Bug 2 — INSERT...SELECT * bypasses NOT NULL DEFAULT columns
-- -----------------------------------------------------------------------------
-- Per the PostgreSQL docs on jsonb_populate_record: "any output columns
-- that do not match any object field will be filled with nulls". So when
-- p_order omits a key, the SELECT row has NULL for that column. The
-- subsequent `INSERT INTO orders SELECT *` then inserts that NULL
-- *explicitly*. Column DEFAULTs only fire for omitted columns, not for
-- explicit NULL values.
--
-- placeOrder.ts (the only caller) does not pass values for any of the
-- following NOT NULL columns, relying on the table's column DEFAULT:
--
--   orders.id                     DEFAULT gen_random_uuid()
--   orders.order_number           DEFAULT public.generate_order_number()
--   orders.created_at             DEFAULT now()
--   orders.updated_at             DEFAULT now()
--   orders.fees_breakdown_version DEFAULT 1
--   order_items.id                DEFAULT gen_random_uuid()
--   order_items.created_at        DEFAULT now()
--
-- After Bug 1 is fixed, each of those columns would have produced a
-- 23502 NOT NULL violation in turn.
--
-- Fix: pre-populate the defaults into the jsonb payload BEFORE
-- jsonb_populate_record consumes it. Using `defaults || p_order` ensures
-- p_order keys win on conflict — the caller can always override.
--
-- Future-proofing note: any NEW NOT NULL DEFAULT column added to
-- public.orders or public.order_items must be added to the
-- jsonb_build_object call below. There is no way to make this fully
-- automatic without scanning information_schema at runtime, which is
-- slower and harder to reason about than maintaining this list.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.commit_order_with_lines(
  p_order jsonb,
  p_lines jsonb
)
RETURNS TABLE(order_id uuid, order_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_order_id     uuid;
  v_order_number text;
  v_order        jsonb;
BEGIN
  -- Pre-populate NOT NULL columns with column-default semantics so the
  -- subsequent INSERT...SELECT * doesn't write NULLs that bypass the
  -- DEFAULTs.  defaults || p_order  →  p_order wins on key conflict.
  v_order := jsonb_build_object(
    'id',                     gen_random_uuid(),
    'order_number',           public.generate_order_number(),
    'created_at',             now(),
    'updated_at',             now(),
    'fees_breakdown_version', 1
  ) || p_order;

  INSERT INTO public.orders
  SELECT * FROM jsonb_populate_record(NULL::public.orders, v_order)
  RETURNING id, order_number INTO v_order_id, v_order_number;

  -- Bulk insert order_items. Each line gets:
  --   1. defaults for NOT NULL columns the caller doesn't pass (id, created_at)
  --   2. the caller's line payload
  --   3. order_id forced to v_order_id last so it can't be overridden
  --
  -- If any line is invalid (variant_id FK violation, line totals tripping
  -- a CHECK constraint, etc.) the whole transaction rolls back — orders
  -- row included.
  INSERT INTO public.order_items
  SELECT * FROM jsonb_populate_recordset(
    NULL::public.order_items,
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id',         gen_random_uuid(),
        'created_at', now()
      )
      || elem
      || jsonb_build_object('order_id', v_order_id)
    )
    FROM jsonb_array_elements(p_lines) elem)
  );

  RETURN QUERY SELECT v_order_id, v_order_number;
END;
$$;

NOTIFY pgrst, 'reload schema';
