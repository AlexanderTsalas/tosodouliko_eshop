-- =============================================================================
-- Offers engine — Phase 4: checkout integration columns on cart_checkout_sessions.
--
-- Two new columns:
--   - applied_codes jsonb (DEFAULT '[]')    — array of strings the customer
--     has entered at checkout. Engine reads this when evaluating.
--   - offer_snapshot jsonb (NULLABLE)        — full EvalResult locked at
--     checkout-intent time per the race-condition defense (decision #16).
--     Used by placeOrder to honor the offer that was eligible at intent
--     even if the engine state shifts before the order actually commits
--     (Stripe completing 30 min later, another cart soft-holding the last
--     unit, the offer expiring, etc.)
--   - snapshot_taken_at timestamptz (NULLABLE) — TTL check input. Snapshot
--     becomes invalid past 2h to prevent stale exploits.
-- =============================================================================

ALTER TABLE public.cart_checkout_sessions
  ADD COLUMN IF NOT EXISTS applied_codes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS offer_snapshot     jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_taken_at  timestamptz;

-- Cap on applied_codes array length (defense against UI abuse). Anything
-- past 20 codes is almost certainly malicious or buggy.
ALTER TABLE public.cart_checkout_sessions
  ADD CONSTRAINT cart_checkout_sessions_applied_codes_array_chk
    CHECK (jsonb_typeof(applied_codes) = 'array' AND jsonb_array_length(applied_codes) <= 20);

COMMENT ON COLUMN public.cart_checkout_sessions.applied_codes IS
'Array of code strings the customer entered at checkout. Engine reads this when evaluating offers for placeOrder. Empty array = no codes; auto-apply offers still fire.';

COMMENT ON COLUMN public.cart_checkout_sessions.offer_snapshot IS
'Locked EvalResult at checkout-intent moment. Captures applied offers + amounts + fee waivers + line allocations so the offer state survives between intent and order commit. Per the race-condition defense in docs/offers-engine-implementation-plan.md §5.7.';

COMMENT ON COLUMN public.cart_checkout_sessions.snapshot_taken_at IS
'When offer_snapshot was captured. placeOrder rejects snapshots older than the TTL (~2h) and falls back to fresh evaluation.';

NOTIFY pgrst, 'reload schema';
