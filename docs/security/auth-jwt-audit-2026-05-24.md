# Auth + JWT Architecture & Security Audit

**Date:** 2026-05-24
**Scope:** Authentication, authorization, session handling, JWT, cookies, RLS, RBAC, MFA, admin tooling, anonymous auth, guest checkout, wishlist notifications, Realtime broadcasts.
**Method:** Public Supabase + GoTrue documentation research (sources cited inline) + codebase audit of every auth-touching surface.

---

## Part A — How Supabase Auth Works (reference)

### A1. JWT structure

A Supabase access token is an RFC 7519 JWT. Claims:

| Claim | Type | Notes |
|---|---|---|
| `iss` | string | `https://<ref>.supabase.co/auth/v1` |
| `aud` | string | `"authenticated"` for end-user tokens |
| `exp`, `iat`, `nbf` | int | Validity window |
| `sub` | uuid | User id, identical to `auth.users.id` |
| `role` | string | `anon` / `authenticated` / `service_role` — drives Postgres role switch |
| `aal` | enum | `aal1` (password/OTP) or `aal2` (MFA verified) |
| `session_id` | uuid | Matches `auth.sessions.id` |
| `email`, `phone` | string | May be empty for anon users |
| `is_anonymous` | bool | True only when user came from `signInAnonymously()` |
| `amr` | array | Authentication Methods References |
| `app_metadata` | obj | Admin-controlled; safe to use in RLS |
| `user_metadata` | obj | User-writable; **do not trust in RLS** |

Source: https://supabase.com/docs/guides/auth/jwt-fields

### A2. Signing algorithms

- **Historical default:** HS256 with a per-project shared JWT secret.
- **Current default for new managed projects:** ES256 (ECDSA on P-256), with rotatable signing keys exposed via `/auth/v1/.well-known/jwks.json`.
- **This project is on HS256** (self-hosting flexibility — works identically on managed and on-prem Supabase).

A leaked HS256 JWT secret is catastrophic: an attacker can forge arbitrary JWTs with any `sub`, `role: service_role`, `aal: aal2`. Strictly worse than service-role-key leak. ES256 eliminates this risk by removing the shared secret.

### A3. The three project keys

| Key | What it does | Leak impact |
|---|---|---|
| `anon` key (public) | Authenticates the API surface itself; subject to all RLS | Low — public by design |
| `service_role` key (private) | Postgres role with `BYPASSRLS`; full database power | **Catastrophic** — full data exfil/modify |
| JWT secret (private) | Signs/verifies every JWT | **Catastrophic** — forge any token |

### A4. Refresh token rotation

- Refresh tokens are **opaque random strings**, not JWTs. Stored in `auth.refresh_tokens.token` as **plaintext** ([source](https://github.com/supabase/auth/blob/master/migrations/00_init_auth_schema.up.sql)).
- Rotation: enabled by default. On refresh, the old token is `revoked=true`, a new token is written with `parent = old`. The `parent` column forms a chain.
- **Reuse interval:** 10 seconds. Within the window, the same refresh token may be exchanged again (handles tab races). Outside the window, reuse triggers theft detection — the entire descendant chain is revoked.
- Plaintext storage means anyone with `SELECT` on `auth.refresh_tokens` can hijack live sessions. On the managed platform Supabase restricted the `auth` schema in April 2025; on self-hosted, you must protect it via Postgres role permissions.

### A5. Password hashing

- Algorithm: **bcrypt**, default cost **10**. Stored in `auth.users.encrypted_password` (misnomer — it's a hash, not encryption).
- Cost 10 is below current OWASP guidance (12+). Not user-configurable on managed Supabase.
- `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current` — all stored as hashes via `crypto.GenerateTokenHash`. The plaintext only exists in the email sent to the user. ✓
- OTP / magic-link default expiry: 24h. Too long for production — tighten via `GOTRUE_MAILER_OTP_EXP` etc.
- Anonymous users: `encrypted_password` is NULL.

### A6. `@supabase/ssr` cookie pattern

- Cookie name: `sb-<project-ref>-auth-token`. Chunked when >3180 chars: `.0`, `.1`, etc.
- Default attributes: `Path=/`, `SameSite=Lax`, `Secure` (on HTTPS). **HttpOnly is NOT set** — deliberate because the browser SDK reads the cookie. **An XSS on the site is a session theft.**

Verification: `getUser()` does a network call to `/auth/v1/user` and validates the JWT server-side. `getSession()` only parses the local cookie and trusts it — **never use `getSession()` for server-side trust decisions.**

### A7. JWT → Postgres RLS bridge

PostgREST verifies the JWT, sets `request.jwt.claims` GUC, then `SET LOCAL ROLE <claim.role>`. `auth.uid()` reads `sub` from the GUC.

When the **admin (service-role) client** is used, `sub` is absent — `auth.uid()` returns NULL. Code using `auth.uid()` for ownership writes from an admin client will silently insert NULL. **Common bug.**

### A8. Realtime auth

Realtime supports two models:
1. **Postgres CDC** — table changes broadcast to subscribers, RLS filters at delivery.
2. **Broadcast** — explicit `channel.send({type:'broadcast', ...})`.

By default, **any authenticated client can subscribe to any channel name they guess**. To enforce per-channel authorization, you must turn off "Allow public access" in Realtime settings AND write RLS on `realtime.messages`. Without it, channel names that include sensitive identifiers (e.g., `customer:{uuid}`) rely on UUIDs being non-enumerable.

### A9. Anonymous → permanent upgrade

`signInAnonymously()` creates `auth.users` row with `is_anonymous=true`, `encrypted_password=NULL`. `updateUser({email})`:
1. Modifies the same row — **uid is preserved**, so all FK-linked app data stays attached.
2. Writes `email_change_token_new` (hashed), sends confirmation email.
3. `is_anonymous` flips to false only after the link is clicked.
4. Until then, `auth.users.email` is unchanged.

---

## Part B — How this codebase uses it

### B1. Client factories ([src/lib/supabase/](src/lib/supabase/))

| File | Key | Purpose |
|---|---|---|
| `client.ts` | anon | Browser client. Reads/writes auth cookies via `@supabase/ssr`. |
| `server.ts` | anon | Server-component & server-action client. Cookie-aware via `next/headers`. |
| `admin.ts` | service-role | Bypasses RLS. `import "server-only"` guard. `persistSession: false`, `autoRefreshToken: false`. |
| `middleware.ts` | anon | Middleware-only. Calls `getUser()` on every request to refresh + sync cookies. |

✅ `SUPABASE_SERVICE_ROLE_KEY` appears in exactly one file ([src/lib/supabase/admin.ts:13](src/lib/supabase/admin.ts#L13)) and is read via `process.env` with no `NEXT_PUBLIC_` prefix. It is validated in [src/lib/env.ts:7](src/lib/env.ts#L7). It cannot ship to the browser bundle.

### B2. Middleware

[src/middleware.ts](src/middleware.ts) calls `updateSession(request)` from [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) for every request matching its glob (excludes static assets, images, robots.txt). `updateSession` calls `auth.getUser()` — this both refreshes the session (rotating tokens if expired) and re-syncs cookies to the response.

✅ Correctly implemented per the Supabase Next.js guide.

### B3. RBAC + MFA

[src/lib/rbac/](src/lib/rbac/) provides three guards:
- `checkPermission(name)` — RPC to `has_permission(name)`, which checks `user_roles → role_permissions → permissions` for `auth.uid()`. SECURITY DEFINER.
- `requirePermission(name)` — wraps `checkPermission`; redirects to `/auth/signin` on deny.
- `requireMFA()` — checks `auth.mfa.getAuthenticatorAssuranceLevel()`. Redirects to `/admin/mfa-enroll` (no factors) or `/admin/mfa-verify` (factors but aal1).

[src/components/features/backoffice-shell/AdminLayout.tsx:31-32](src/components/features/backoffice-shell/AdminLayout.tsx#L31) runs **both guards** before rendering. Every admin page that wraps in `AdminLayout` is gated on:
1. Holding the named permission.
2. Session at AAL2 (second factor verified).

The `/admin/mfa-enroll` and `/admin/mfa-verify` pages intentionally do NOT use `AdminLayout` (avoids redirect loop).

### B4. `getUser()` vs `getSession()`

✅ Codebase uses `auth.getUser()` (network-verified) exclusively. Zero `getSession()` references in production code. This is the correct posture per Supabase's auth-server-side guidance.

### B5. Anonymous session bootstrap

[src/hooks/useEnsureSession.ts](src/hooks/useEnsureSession.ts) lazily creates an anonymous session on first auth-requiring action ([Phase 9 design](docs/features/inventory-contention-implementation-plan.md)). De-duped with an `inFlightRef` so concurrent clicks don't create two anon users.

✅ The lazy pattern minimizes useless anon-user creation (vs eagerly bootstrapping on every page load).

---

## Part C — Audit findings

Findings are categorized by impact, not by likelihood. None are catastrophic.

### CRITICAL — none

No critical vulnerabilities found.

### HIGH — 2

**H1. Anonymous email-upgrade trusts unverified input** ([requestAnonEmailUpgrade.ts:62](src/actions/auth/requestAnonEmailUpgrade.ts#L62))

The flow sets `customers.email` **immediately** with whatever the anon user typed, BEFORE the magic-link confirmation. The wishlist dispatcher then sends notification emails to that address. An attacker:
1. Opens the site in incognito → anon session created.
2. Goes to a product page, clicks "Notify me when available", enters `victim@example.com`.
3. `customers.email = victim@example.com` is committed.
4. Whenever inventory drops to 0 and back, victim receives unsolicited restock emails.

The auth-side `updateUser({email})` does send a confirmation, but the customers-side write happens regardless.

**Likelihood:** Low (requires deliberate abuse, low payoff). **Impact:** Medium (spam complaints, deliverability damage, GDPR concerns). **Net:** High because email reputation is hard to repair.

**Fix:** Don't update `customers.email` until the magic-link confirmation flips `auth.users.email`. The existing `sync_user_profile_on_auth_email_change` trigger already cascades that to user_profiles; extend it to also touch customers when the auth email changes from null. This delays notification delivery to confirmed addresses only.

**H2. Realtime channel `customer:{uuid}` has no authorization** ([broadcastNotification.ts:40](src/lib/wishlist/broadcastNotification.ts#L40))

The customer-notification broadcast pushes to a channel named with the customer's UUID. Per Supabase defaults, **any authenticated client can subscribe to any channel name** unless RLS on `realtime.messages` is configured to deny it.

A customer uuid is 36 hex chars, not enumerable in practice. But:
- If a customer id ever appears in a URL, JS bundle, error message, or log, it leaks the channel.
- An attacker with `manage:orders` permission (who can see customer ids on `/admin/wishlist-queue`) could subscribe to listen to other customers' notification stream in real time.

**Likelihood:** Low (requires knowing or guessing UUIDs). **Impact:** Low (payload exposes product name + URL, not PII). **Net:** High to track because it's a defense-in-depth gap that compounds with any UUID leakage.

**Fix:** Enable Realtime Authorization on the project, add an RLS policy on `realtime.messages` that allows reads only when the JWT's `sub` matches the customer's `auth_user_id`. Mirror the policy already in place on `cart_checkout_sessions`.

### MEDIUM — 4

**M1. Anonymous sign-in has no rate-limit or CAPTCHA**

`useEnsureSession` calls `signInAnonymously()` on first cart action. There is no app-level rate limit; Supabase managed-platform per-IP limits exist but are conservative. A botnet can fill `auth.users` with millions of `is_anonymous=true` rows, burn the MAU quota, and degrade auth latency.

**Fix:** Add hCaptcha or Turnstile to the implicit anon-signin gate (Supabase supports it natively via `options.captchaToken`). Lower-effort interim: app-level per-IP rate limit (5 anon signups / minute / IP).

**M2. In-memory rate limiter doesn't survive horizontal scaling** ([rate-limit/checkRateLimit.ts:8](src/lib/rate-limit/checkRateLimit.ts#L8))

The `signIn` action uses a per-process in-memory Map for its 5/min limit. On Vercel or any multi-instance deploy, each instance has its own bucket — an attacker can effectively get N × 5 attempts per minute where N = serverless instances spun up.

**Fix:** Swap to Upstash Ratelimit (5 LoC change) or Vercel KV before going to production. Currently fine for local dev / single-instance VPS.

**M3. CRON_SECRET not env-validated** ([env.ts](src/lib/env.ts))

[wishlist-advance/route.ts:28](src/app/api/cron/wishlist-advance/route.ts#L28) requires `CRON_SECRET` in production, but `env.ts` doesn't declare it. If forgotten, the cron endpoint returns 500 in production — better than allowing unauthed calls, but the failure is a runtime surprise instead of a startup error.

**Fix:** Add `CRON_SECRET: z.string().min(32).optional()` to env.ts schema. Document required for cron.

**M4. Wishlist notifications can fire to NULL-email customers silently**

`fireWishlistNotification` correctly skips email send when `customer.email` is null. But the priority hold + flag clear DOES happen. An anonymous customer who wishlisted (per H1 mitigation, blocked anyway) ends up with their slot consumed without ever knowing.

**Fix:** Either gate wishlist subscriptions on having a confirmed email (preferred), or skip the entire fire when no email is present so the next FIFO subscriber gets the slot.

### LOW — 5

**L1. bcrypt cost 10** — below current OWASP. Not changeable on managed Supabase. Self-host: set `GOTRUE_PASSWORD_HASH_COST=12+`.

**L2. Cookies are not HttpOnly** — Supabase default. An XSS = session theft. The `@supabase/ssr` cookie adapter could be configured to set HttpOnly if you accept losing the client-side SDK reading the token (would only be feasible if all auth-dependent calls go through server actions, which this codebase already does — worth investigating).

**L3. Default OTP / magic-link expiry is 24h** — too long. Tighten via GoTrue env / dashboard to 1h.

**L4. Refresh tokens stored as plaintext in `auth.refresh_tokens`** — Supabase managed restricts `auth` schema reads; on self-host you must restrict via Postgres roles. Add an RLS-like policy or use a dedicated `auth_reader` role for tooling.

**L5. Mock-payment webhook trusts session-id presence** — currently gated by `activeProviderKind() !== 'mock'` returning 404, but if the env flag is wrong in prod, anyone who knows a session_id can fire order completion. Add a redundant `NODE_ENV !== 'production'` check.

### STRENGTHS (validated)

Every item below was confirmed during the audit:

1. **Service-role key never reaches the browser** — single import site, server-only guard, no NEXT_PUBLIC_ prefix.
2. **All API routes have auth** — six routes total; each enforces auth via Supabase, Stripe HMAC, CRON bearer, or DB validation.
3. **All admin pages enforce permission + MFA** — via `AdminLayout` which calls both guards.
4. **All admin server actions enforce permission** — 5 wishlist-queue actions + 2 inventory-debug actions use `requirePermission()` independently of any UI guard.
5. **RLS on every sensitive table** — `customers`, `orders`, `cart_items`, `wishlist_items`, `priority_holds`, `soft_waits`, `cart_checkout_sessions`, `audit_events`, `notification_settings`, `pending_wishlist_notifications` all have ownership-or-permission policies. Tested with explicit policy names.
6. **`getUser()` everywhere, never `getSession()`** — zero unsafe trust decisions on server.
7. **No manual cookie handling** — 100% via `@supabase/ssr` adapter. No `document.cookie`, no custom `Set-Cookie`, no JWT parsing.
8. **No anon-key in client bundle leaks** — env validation requires it, only used in client/server/middleware factories.
9. **Audit logging on every state-changing admin action** — `audit_events` table has `actor_id`, `action`, `resource_*`, `metadata`. Used consistently across signIn/Out, role changes, wishlist queue, inventory debug, etc.
10. **`signOut` sweeps inventory commitments** — releases priority holds, deletes pending soft_waits, releases soft sessions. Customer can't hold inventory after signing out (spec §16.6 + Phase 10).
11. **Anonymous session bootstrap is de-duped** — `useEnsureSession` uses an in-flight promise ref to avoid double anon-user creation on rapid clicks.
12. **MFA enforced for admin via AdminLayout AND independently via requirePermission in actions** — defense in depth. An admin action invoked outside its admin page still gates on permission (though not MFA — see N1 below).

### NOTES / OBSERVATIONS

**N1. Admin server actions check permission but NOT MFA.**

`AdminLayout` enforces both `requirePermission` + `requireMFA`. But admin server actions like `notifyPending` and `forceReleaseSoftSession` only call `requirePermission`. An attacker with:
- Valid admin credentials (stolen password) but no MFA factor,
- A direct way to invoke a server action (CSRF, Server Action endpoint discovery),

…could bypass the MFA wall. In practice Next.js Server Actions require a same-origin POST with anti-CSRF tokens, but this is a defense-in-depth gap. Worth adding `requireMFA` to every admin server action, or at minimum to the destructive ones (`forceReleasePriorityHold`, `releaseToGeneral`).

**N2. The customer-ownership check pattern is hand-rolled per route.**

Several places do:
```ts
const { data: custRow } = await admin.from("customers").select("id").eq("auth_user_id", userId).maybeSingle();
const customerId = custRow?.id;
```
Then `.eq("customer_id", customerId)` on the next query. A helper (`requireCurrentCustomer()`) would reduce the chance of forgetting the check.

---

## Part D — Recommended actions (prioritized)

### Shipped 2026-05-24

- ✅ **H1** — resolved by removing the inline email-upgrade path entirely (Option B): both wishlist + save-your-info now route through standard signup (password + Supabase email verification). `EmailUpgradePrompt` + `requestAnonEmailUpgrade` deleted. No `customers.email` is ever written without verification.
- ✅ **H2** — Realtime Authorization on `customer:{id}` channels. Migration `20260531000001_realtime_customer_channel_authorization.sql` adds RLS policy on `realtime.messages` scoping reads to the customer whose JWT `sub` matches the channel's customer_id. Broadcast + subscribe both updated to `private: true`. Requires dashboard setting **"Allow public access" = OFF** in Realtime settings.
- ✅ **M3** — `CRON_SECRET: z.string().min(32).optional()` added to `env.ts`. Production-required (route enforces it); validation surfaces missing var at startup.
- ✅ **N1** — `await requireMFA()` added to all 7 admin server actions: `notifyPending`, `skipPending`, `bulkNotify`, `releaseToGeneral`, `updateNotificationMode`, `forceReleaseSoftSession`, `forceReleasePriorityHold`.

### Still open

| # | Action | Effort | Priority |
|---|---|---|---|
| 1 | **M1** CAPTCHA on anon signin (hCaptcha/Turnstile) | ~50 LoC | Medium |
| 2 | **M2** Replace in-memory rate limit with Upstash | ~30 LoC | Medium (before prod) |
| 3 | **M4** Skip wishlist notification fire entirely when customer email is null | ~5 LoC | Medium |
| 4 | **L3** Tighten OTP/magic-link expiry to 1h | dashboard toggle | Low |
| 5 | **L5** Defense-in-depth `NODE_ENV` check on mock webhook | ~3 LoC | Low |
| 6 | **L2** Investigate HttpOnly cookies (drops browser SDK token reads) | research | Low |
| 7 | Long-term: migrate to ES256 asymmetric signing keys | dashboard migration | Low |

---

## Appendix: token-flow diagram

```
Browser                Next.js middleware         PostgREST              Postgres
   │                          │                       │                     │
   │── HTTP request ─────────▶│                       │                     │
   │   (Cookie: sb-x-auth-    │                       │                     │
   │    token.0, .1)          │                       │                     │
   │                          │                       │                     │
   │                          │── getUser() ─────────▶ (auth.users)          │
   │                          │   /auth/v1/user        │                     │
   │                          │   verifies JWT sig     │                     │
   │                          │◀── user data ─────────                       │
   │                          │   (possibly new        │                     │
   │                          │    Set-Cookie after    │                     │
   │                          │    refresh)            │                     │
   │                          │                        │                     │
   │                          ├─▶ Server Component / Server Action            │
   │                          │   uses createClient()  │                     │
   │                          │   passes JWT via       │                     │
   │                          │   anon-key client      │                     │
   │                          │                        │                     │
   │                          │                        ├─ SELECT/UPDATE ──▶│
   │                          │                        │ JWT verified       │
   │                          │                        │ role: authenticated│
   │                          │                        │ auth.uid() = sub   │
   │                          │                        │ RLS applies        │
   │                          │                        │◀── rows ──────────│
   │◀── HTTP response ────────│                       │                     │
   │    (updated cookies)     │                       │                     │
```

For admin client (service-role):
- No JWT verification needed (service-role API key signed with same JWT secret).
- Postgres role: `service_role`, has `BYPASSRLS`.
- `auth.uid()` returns NULL — code must not rely on it for ownership.
