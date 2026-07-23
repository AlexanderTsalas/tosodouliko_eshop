-- =============================================================================
-- Move the Greek phone-normalization heuristic into the database so the
-- app and DB compute the SAME canonical form.
--
-- Background:
--   The original customers.phone_normalized was a GENERATED column using
--   plain regexp_replace:
--     NULLIF(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'), '')
--
--   src/lib/customers/normalize.ts adds a Greek heuristic the DB didn't:
--     - "6912345678"   → "+306912345678"   (bare 10-digit, mobile prefix 6)
--     - "2101234567"   → "+302101234567"   (bare 10-digit, landline prefix 2)
--     - "306912345678" → "+306912345678"   (12-digit no plus)
--     - Everything else: stripped to digits and leading +
--
--   App stored "+306912345678" but the generated column kept "6912345678",
--   so dedup queries (eq("phone_normalized", "+306912345678")) silently
--   missed customers entered as the bare form — duplicate customers
--   accumulated.
--
-- Fix:
--   1. Create an IMMUTABLE plpgsql function that mirrors the JS heuristic
--      exactly. IMMUTABLE is required for use in a GENERATED column.
--   2. Drop the existing generated column.
--   3. Add it back using the function — which forces a one-time backfill
--      so every existing row gets the canonical form.
--
-- Behavior change: existing customer records with phone "6912345678"
-- (stored bare) will have phone_normalized recomputed to "+306912345678"
-- automatically. Future dedup lookups will match cross-form variants.
--
-- Drop the index on phone_normalized first (Postgres rebuilds it).
-- =============================================================================

-- The function — pure SQL is enough but plpgsql is more readable.
-- IMMUTABLE because: same input always yields same output; no DB state.
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  stripped text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;
  -- Strip everything except digits and a leading '+'. Same regex
  -- the previous generated column used.
  stripped := regexp_replace(p_phone, '[^0-9+]', '', 'g');
  IF stripped = '' THEN
    RETURN NULL;
  END IF;
  -- Greek default-prefix heuristics, matching src/lib/customers/normalize.ts:
  --   bare 10-digit starting with 6 (mobile) or 2 (landline) → prepend +30
  --   12-digit starting with 30 (no plus) → just add the +
  IF stripped ~ '^[62]\d{9}$' THEN
    RETURN '+30' || stripped;
  END IF;
  IF stripped ~ '^30[62]\d{9}$' THEN
    RETURN '+' || stripped;
  END IF;
  RETURN stripped;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone(text) IS
'Canonical phone normalization. Greek bare 10-digit mobile/landline numbers get +30 prefix; everything else stripped to digits/plus. Must stay in sync with src/lib/customers/normalize.ts normalizePhone().';

-- Drop the old generated column. (Postgres can't ALTER a generated
-- column's formula, only DROP + ADD.)
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS phone_normalized;

-- Add it back using the canonical function. STORED so existing indexes
-- on phone_normalized can be rebuilt and the value is available without
-- per-row computation on read.
ALTER TABLE public.customers
  ADD COLUMN phone_normalized text
  GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;

-- Rebuild the lookup index (the DROP COLUMN removed the prior one).
-- The original schema in 20260518000001_customers_entity.sql created
-- a composite (email_normalized, phone_normalized) index — recreate it
-- with the same shape.
CREATE INDEX IF NOT EXISTS idx_customers_email_phone_normalized
  ON public.customers (email_normalized, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized
  ON public.customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

NOTIFY pgrst, 'reload schema';
