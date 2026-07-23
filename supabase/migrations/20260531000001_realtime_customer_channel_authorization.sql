-- =============================================================================
-- Phase 6.5 H2 fix — Realtime Authorization on customer:{id} broadcast.
--
-- Before this migration the `customer:{customer_id}` channel used by
-- `broadcastWishlistNotification` was subscribable by any authenticated
-- client that knew (or guessed) the customer id. UUIDs are not enumerable
-- in practice but any leak of an id through admin UI / logs / errors
-- compounds the exposure.
--
-- After:
--   1. Realtime Authorization must be enabled at the project level
--      ("Allow public access" toggled OFF in Dashboard → Realtime, or
--      `REALTIME_PUBLIC_AUTHORIZATION=false` on self-hosted).
--   2. The RLS policy below on `realtime.messages` restricts SELECT on
--      broadcast topics of the form `customer:<uuid>` to the customer whose
--      `auth_user_id` matches the calling JWT's `sub`.
--   3. Clients must subscribe with `{ config: { private: true } }` (so the
--      RLS layer applies). Server-side admin-client broadcasts continue to
--      publish regardless (service_role bypasses RLS).
--
-- Result: only the customer whose channel it is can receive the wishlist
-- restock-notification broadcast. Admins with `manage:wishlist_queue` see
-- the same events via the admin UI's pending-notifications queue, not the
-- customer's channel.
-- =============================================================================

-- The realtime.messages table is provisioned by Supabase Realtime; if it
-- doesn't exist (e.g., very old self-hosted install), this migration is a
-- no-op. Wrap in DO block so the migration still applies cleanly.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'realtime' AND table_name = 'messages'
  ) THEN
    -- Drop any prior version of the policy so re-runs are idempotent.
    EXECUTE 'DROP POLICY IF EXISTS "customer_channel_owner_read"
             ON realtime.messages';

    EXECUTE $POLICY$
      CREATE POLICY "customer_channel_owner_read"
        ON realtime.messages FOR SELECT TO authenticated
        USING (
          realtime.topic() LIKE 'customer:%'
          AND substring(realtime.topic() FROM 10) IN (
            SELECT id::text FROM public.customers
            WHERE auth_user_id = (SELECT auth.uid())
          )
        );
    $POLICY$;
  ELSE
    RAISE NOTICE 'realtime.messages not present — skipping H2 policy. Re-run after enabling Realtime.';
  END IF;
END $$;

-- Note: no `COMMENT ON SCHEMA realtime` here — the migration role
-- doesn't own the realtime schema on managed Supabase, so altering its
-- comment errors with 42501 and rolls back the entire migration. The
-- policy itself is the contract; this file header documents intent.
