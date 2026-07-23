-- =============================================================================
-- Related-products engine: replace `priority` with `display_order` + add
-- `bidirectional` flag.
--
-- Why the rename:
--   The original `priority` column was sorted DESC at the resolver, so
--   larger numbers meant "higher in the carousel stack". The admin UI
--   reads more naturally as a POSITION ("1η από πάνω σε σειρά" = 1st
--   from the top), where 1 = topmost. Flipping the sort direction
--   without renaming the column would leave future readers reading
--   "priority" and assuming "higher = first" — exactly the convention
--   we're moving away from. Renaming makes the semantics self-
--   documenting at the call site.
--
-- Backfill strategy:
--   Preserve the visible order each association has TODAY. Existing rows
--   are ordered by (priority DESC, created_at DESC) — the resolver's
--   current sort — and assigned display_order = 1, 2, 3, ... in that
--   order. After the migration the resolver sorts display_order ASC,
--   yielding the same render order on storefront pages that have these
--   associations.
--
-- Why add bidirectional:
--   The admin UX gets a new toggle "Ισχύει και Αντίστροφα" that lets one
--   association fire from both directions. Without it, an association
--   only fires when the viewer matches the source side; with it, the
--   resolver does a second evaluation where source ↔ target are
--   swapped, so a viewer on the target-matching side ALSO sees a
--   carousel (showing source-side products).
-- =============================================================================

-- ─── Step 1: add the new columns ─────────────────────────────────────
ALTER TABLE public.related_products_associations
  ADD COLUMN IF NOT EXISTS display_order  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bidirectional  boolean NOT NULL DEFAULT false;

ALTER TABLE public.related_products_associations
  ADD CONSTRAINT related_products_associations_display_order_chk
    CHECK (display_order >= 1);

-- ─── Step 2: backfill display_order preserving current visible order ─
-- Use a CTE to compute the row's position in the current
-- (priority DESC, created_at DESC) ordering and write that back into
-- display_order. Idempotent-friendly: we re-stamp ALL rows so re-running
-- the migration over a partially-backfilled state still produces a
-- consistent monotonic sequence.
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY priority DESC, created_at DESC) AS rn
  FROM public.related_products_associations
)
UPDATE public.related_products_associations a
   SET display_order = ordered.rn
  FROM ordered
 WHERE a.id = ordered.id;

-- ─── Step 3: replace the old index that referenced priority ──────────
DROP INDEX IF EXISTS public.idx_rpa_active_priority;
CREATE INDEX IF NOT EXISTS idx_rpa_active_display_order
  ON public.related_products_associations(active, display_order ASC)
  WHERE active = true;

-- ─── Step 4: drop the old priority column ────────────────────────────
ALTER TABLE public.related_products_associations
  DROP COLUMN IF EXISTS priority;

-- ─── Comments ────────────────────────────────────────────────────────
COMMENT ON COLUMN public.related_products_associations.display_order IS
'Position on a product page (1 = topmost). The resolver sorts ASC by this column when multiple associations match a viewer. Tie-breaker is created_at DESC.';

COMMENT ON COLUMN public.related_products_associations.bidirectional IS
'When true the resolver runs a second pass with source ↔ target swapped. A viewer that matches the target side then sees a carousel of source-side products. Default is false (forward-only matching). On a single page a given association still produces at most one carousel — source→target wins if the viewer somehow matches both sides.';

NOTIFY pgrst, 'reload schema';
