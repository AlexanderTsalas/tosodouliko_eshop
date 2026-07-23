# Offers Engine — Implementation Plan

**Status:** Approved (conceptualization → ready for phased implementation)
**Replaces:** the legacy single-table `discount_codes` model from `20260430000015_discount_engine_schema.sql`
**Scope:** Offers, rules, scopes, conditionals, affiliates, and their full integration into checkout pricing + storefront display.

---

## 1. Locked decisions

From the conceptualization iteration, the following design decisions are final and drive the rest of this plan:

| # | Decision | Implementation impact |
|---|---|---|
| 1 | **No activation cron**: timeframe evaluated at query time via `now() BETWEEN starts_at AND ends_at`. | Removes a whole class of state-sync bugs. Cron is reserved for *deactivation side-effects* only (e.g., email "your sale just ended" — out of scope for v1). |
| 2 | **Stacking model**: per-offer `stacking_mode` flag — `stack` / `exclusive_within_kind` / `global_exclusive`. Default `exclusive_within_kind`. | Engine evaluates eligible offers, groups by kind, applies stacking rule per group. |
| 3 | **Precedence when non-stack offers compete**: best-for-customer (deepest absolute discount). | Engine computes the post-discount total under each candidate offer and picks the lowest. |
| 4 | **Auto-apply vs code-required**: `offers.requires_code` boolean. The presence of any `discount_codes` row pointing at an offer implies `requires_code=true`. | Auto-apply offers contribute to storefront crossed-out prices + badges; code-required offers stay hidden until checkout. |
| 5 | **Stock-threshold semantics**: state-based — "while stock ≤ X" — evaluated at every cart/checkout query. No cron. | Composes cleanly with timeframe ("while stock ≤ X **and** date in range"). |
| 6 | **Pricing lock-in moment**: at order placement (`placeOrder`). Cart shows live prices; the authoritative price is sealed in `order_items.unit_price` + `orders.discount_amount` when the row commits. | Avoids stale-price disputes; offers can expire mid-cart without breaking checkout. |
| 7 | **VAT on discounts**: VAT computed on the *discounted* amount (post-discount → pre-tax). | When VAT lands (currently `taxAmount = 0`), it consumes the post-discount subtotal. Phase 1 stays VAT-agnostic since `taxAmount` is still placeholder. |
| 8 | **"Free shipping" cost-bearer**: store absorbs (carrier still charges; customer charge waived). | Modeled as `waive_customer_charge: true` on the shipping waiver rule — the `fees_breakdown` row keeps `api_quote` for accounting; `charged` becomes 0. |
| 9 | **BOGO greediness**: greedy by default. `max_applications_per_cart` (nullable int) on the bundle rule lets admins cap. | Engine loops the trigger until cart can no longer satisfy the condition. |
| 10 | **Code-bearing offer storefront visibility**: hidden — no badges, no crossed-out prices. Discount applies only at checkout when entered. | Storefront price computation skips offers where `requires_code=true`. |
| 11 | **Stock-threshold `product` scope**: "every variant of this product that falls below the threshold gets the offer rule". Threshold is evaluated PER-VARIANT, not against an aggregate of all variants. | Engine resolves product-scope to its variants and evaluates each variant's stock independently. Eligibility becomes **per-line**, not per-offer: a single offer may apply to some lines in the cart and not others. |
| 12 | **Multiple codes per cart are allowed**: as long as the customer is eligible per each rule, all applicable codes apply (subject to each offer's own `stacking_mode`). "The control should be a business decision, not a hard constraint." | Cart holds an array of applied codes; the engine evaluates all of them together. Admin can still scope offers as `global_exclusive` to lock them down per offer, but the platform never refuses a second code outright. |
| 13 | **Refund proration is in scope (v1)**: when items are returned, the offer engine re-evaluates against the remaining cart. If a rule's trigger no longer holds, the offer **dissolves** — its discount allocation is removed from the refund calculation. Refund formula: `refund = old_total_paid − new_total_owed_after_return`. | Pulls refund proration out of the deferred Phase 8 bucket and into Phase 7. Admin gets a preview of the auto-calculated refund + an override field for goodwill exceptions. |
| 14 | **RBAC defense in depth**: offer creation/modification is gated at every layer — RLS policy on the table, `checkPermission("manage:discounts")` in every server action, `<RequirePermission>` in every UI form, mandatory `logAuditEvent` on every CUD. No layer trusts the others. | Engine reads are public (storefront needs auto-apply offers) but writes are admin-only at FOUR independent enforcement points. |
| 15 | **Stock-threshold rules evaluate against effective available stock** (`quantity_available − quantity_reserved − active_soft_holds`), not raw `quantity_available`. Same contention-aware number the oversell flow uses. | Engine calls `getContestableAvailable` for stock checks. Soft holds by other carts visibly reduce the offer's applicability in real time. |
| 16 | **Offer applicability is locked at checkout intent**, not at payment completion. The lock is captured as an `offer_snapshot jsonb` on `cart_checkout_sessions`. For Stripe orders, the snapshot is also written to the Stripe Checkout Session's metadata so the webhook can honor it on `checkout.session.completed`. | Customer with open Stripe session keeps their discount even if the offer expires, another cart soft-holds the last unit, or any other state change occurs between intent and completion. The snapshot is the source of truth post-intent. |
| 17 | **Soft vs hard conditional enforcement** — split per the table in §1.1 below. Stock/subtotal/user-type/code are HARD; usage limits and date ranges are SOFT by default. A per-offer `enforce_limits` boolean lets admins opt into hard enforcement when needed (contractual caps). | Engine has a two-pass eligibility check: HARD conditionals must all pass; SOFT conditionals only produce admin warnings unless `enforce_limits=true`. |
| 18 | **Codes can be restricted to specific customers** (whitelist mode), with optional auto-apply for whitelisted customers. **This is for gift codes** ("merchant wants to give a discount to a good customer or a friend"), NOT for affiliates. Affiliate codes remain universal — the affiliate is identified by the offer/code naming + the `discount_codes.affiliate_id` attribution, on the assumption that only the affiliate's audience knows the code in the first place. | New `offer_code_customers` junction table (renamed from the earlier sketch — see §3.4.1). Code lookup checks the junction; if populated, the entering customer must be on the list. Auto-apply flag triggers engine to apply the code without explicit entry. Empty junction = universal code (the affiliate case). |

---

### 1.1 Conditional enforcement matrix (decision #17)

Each conditional has a fixed enforcement mode. The engine evaluates HARD conditionals as gates; SOFT conditionals contribute warnings to a separate channel that surfaces in the admin UI but doesn't block application.

| Conditional | Enforcement | Behaviour at limit | Admin override |
|---|---|---|---|
| Time range (`starts_at` / `ends_at`) | **HARD for new carts** / **SOFT for in-flight carts** (via offer_snapshot lock — decision #16) | New carts past `ends_at` see the offer disappear; carts that already captured a snapshot keep their lock | Extend `ends_at` at any time |
| User type | **HARD** | Mismatched user type → offer not eligible | n/a (identity-based) |
| Min subtotal / item_count | **HARD** | Below threshold → offer not eligible | n/a (cart-shape-based) |
| Code requirement | **HARD** | No code entered → offer not eligible (for code-required offers) | n/a (binary) |
| Stock threshold | **HARD** (per decision #5 + #15) | Stock above threshold → offer not eligible for that line | n/a (state-based) |
| `max_uses_total` | **SOFT by default** | Engine continues to apply; admin gets a banner: "BLACKFRIDAY has reached 500/500 uses" | Per-offer `enforce_limits=true` to make HARD |
| `max_uses_per_customer` | **SOFT by default** | Engine continues to apply; admin gets a banner per customer who exceeds | Same `enforce_limits` flag |
| Code restricted to customer whitelist | **HARD** (per decision #18) | Non-whitelisted customer cannot use the code | n/a (security-relevant) |

The `offers.enforce_limits boolean DEFAULT false` column flips both `max_uses_total` and `max_uses_per_customer` to HARD mode when set. Single switch keeps the data model simple.

## 2. Current state (audit summary)

What exists today in the codebase:

```
discount_codes         — flat table; (code, type, value, usage_limit, usage_count, expires_at, is_active)
                         types: 'percent' | 'fixed' | 'free_shipping'
discount_usage         — junction (discount_id, user_id, order_id, amount_applied)
applyDiscount action   — validates code, increments usage atomically, records usage
validateDiscount lib   — server-side validator (input: code, subtotal)
orders.discount_amount — column exists; currently hardcoded to 0 in placeOrder.ts
fees engine            — separate system; rules-engine architecture with fees_breakdown jsonb
order_items            — unit_price, total (no discount allocation per line yet)
storefront pricing     — uses variant.price raw; no offer computation
admin /admin/discounts — single page; CRUD on flat discount_codes table
```

**Three integration points** that need wiring:

1. `placeOrder.ts:593` — `const discountAmount = 0;` (hardcoded). The engine must replace this with the evaluation result.
2. Storefront product detail (`ProductDetailInteractive.tsx`) + catalog tile (`products/page.tsx`) — prices come from `variant.price` raw. Auto-apply offers must produce a `discounted_price` + `original_price` for display.
3. Cart page — same as storefront; needs to show line-level + cart-level discounts as line items.

---

## 3. Target data model

Seven tables. The legacy `discount_codes` + `discount_usage` are **dropped after backfill** (Phase 7 of the migration sequence below).

### 3.1 `offers` — the named container

```sql
CREATE TABLE public.offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  active          boolean NOT NULL DEFAULT true,

  -- Eligibility / conditionals
  starts_at       timestamptz,                 -- nullable = "no start gate"
  ends_at         timestamptz,                 -- nullable = "no end gate"
  user_type       text NOT NULL DEFAULT 'any', -- 'any' | 'authenticated' | 'guest'
  requires_code   boolean NOT NULL DEFAULT false,
  min_subtotal    numeric(10,2),               -- nullable = no minimum
  min_item_count  integer,                     -- nullable = no minimum

  -- Stacking + limits
  stacking_mode   text NOT NULL DEFAULT 'exclusive_within_kind',
                  -- 'stack' | 'exclusive_within_kind' | 'global_exclusive'
  priority        integer NOT NULL DEFAULT 0,  -- tie-breaker when multiple stack
  max_uses_total  integer,                     -- nullable = unlimited
  max_uses_per_customer integer,               -- nullable = unlimited
  current_uses    integer NOT NULL DEFAULT 0,  -- denorm counter
  -- When true, max_uses_total + max_uses_per_customer are HARD limits
  -- (engine refuses to apply past them). When false (default), the
  -- engine continues to apply + the admin sees warning banners.
  -- See decision #17.
  enforce_limits  boolean NOT NULL DEFAULT false,

  -- Stock-threshold conditional (nullable; null = no stock gating)
  stock_threshold       integer,
  stock_scope_kind      text,  -- 'variant' | 'product' | NULL
  stock_scope_id        uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Constraints
  CHECK (user_type IN ('any','authenticated','guest')),
  CHECK (stacking_mode IN ('stack','exclusive_within_kind','global_exclusive')),
  CHECK (stock_threshold IS NULL OR stock_scope_kind IS NOT NULL),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
```

RLS: public SELECT only for `active=true AND requires_code=false` rows (auto-apply ones drive storefront badges); admin full write via `manage:discounts`.

### 3.2 `offer_scopes` — what the offer targets

```sql
CREATE TABLE public.offer_scopes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  scope_kind  text NOT NULL,                   -- 'all' | 'category' | 'product' | 'variant'
  resource_id uuid,                            -- NULL when scope_kind='all'
  CHECK (scope_kind IN ('all','category','product','variant')),
  CHECK ((scope_kind = 'all') = (resource_id IS NULL))
);
CREATE INDEX idx_offer_scopes_offer ON public.offer_scopes(offer_id);
CREATE INDEX idx_offer_scopes_resource ON public.offer_scopes(scope_kind, resource_id);
```

Many-to-one. An offer can target multiple scopes (e.g., "20% off Categories: Toys, Books"). Scope `'all'` is store-wide.

### 3.3 `offer_rules` — the actions (what the offer does)

```sql
CREATE TABLE public.offer_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id        uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  active          boolean NOT NULL DEFAULT true,
  kind            text NOT NULL,
                  -- 'percent_discount' | 'flat_discount'
                  -- | 'bundle_bxgy'
                  -- | 'waive_shipping' | 'waive_cod' | 'waive_all_fees'

  -- Discount rule fields (NULL for non-discount kinds)
  discount_value  numeric(10,4),               -- e.g., 0.20 for 20%, or 5.00 for -€5

  -- Bundle rule fields (NULL for non-bundle kinds)
  trigger_scope_kind  text,                    -- 'product' | 'variant' | 'category'
  trigger_scope_id    uuid,
  trigger_quantity    integer,
  reward_scope_kind   text,
  reward_scope_id     uuid,
  reward_quantity     integer,
  reward_discount     numeric(10,4) DEFAULT 1.0, -- 1.0 = 100% off ("free"); 0.5 = 50% off
  max_applications_per_cart integer,           -- NULL = greedy

  -- Service-fee waiver fields
  waive_threshold_kind  text,                  -- 'cart_total' | 'products_total' | NULL
  waive_threshold_value numeric(10,2),         -- NULL = always waive
  waive_customer_charge boolean DEFAULT true,  -- true = store absorbs; carrier still paid

  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (kind IN (
    'percent_discount','flat_discount',
    'bundle_bxgy',
    'waive_shipping','waive_cod','waive_all_fees'
  )),
  -- Discount kinds require discount_value
  CHECK (kind NOT IN ('percent_discount','flat_discount') OR discount_value IS NOT NULL),
  -- Bundle kind requires trigger + reward
  CHECK (kind != 'bundle_bxgy' OR (
    trigger_scope_kind IS NOT NULL AND trigger_quantity IS NOT NULL
    AND reward_scope_kind IS NOT NULL AND reward_quantity IS NOT NULL
  ))
);
CREATE INDEX idx_offer_rules_offer ON public.offer_rules(offer_id) WHERE active = true;
```

One offer can have many rules. Example: "Black Friday Bundle" offer with two rules: `bundle_bxgy` (buy 2 toys, get 1 free) + `waive_shipping` (any qualifying cart).

The discriminator pattern (kind + nullable kind-specific columns) is used elsewhere in the codebase (e.g., `fees_breakdown` entries). Easier to query than 3 separate sub-tables; trade-off is wider rows.

### 3.4 `discount_codes` — thin pointer into offers

```sql
-- DROP the legacy table after backfill, then create:
CREATE TABLE public.discount_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  offer_id        uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  affiliate_id   uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_discount_codes_offer ON public.discount_codes(offer_id);
CREATE INDEX idx_discount_codes_affiliate ON public.discount_codes(affiliate_id) WHERE affiliate_id IS NOT NULL;
```

**Backward compatibility**: the table name + `code` column stay identical so existing `applyDiscount` action keeps working (with body rewritten to look up the offer + evaluate).

### 3.4.1 `discount_code_customers` — customer whitelist for codes (decision #18)

```sql
CREATE TABLE public.discount_code_customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id uuid NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  customer_id      uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- When true, the engine auto-applies this code for this customer
  -- without requiring them to enter it (frictionless affiliate flow).
  -- When false, the customer must still enter the code at checkout;
  -- the whitelist is purely a permission gate, not auto-apply.
  auto_apply       boolean NOT NULL DEFAULT false,
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (discount_code_id, customer_id)
);
CREATE INDEX idx_dcc_code ON public.discount_code_customers(discount_code_id);
CREATE INDEX idx_dcc_customer ON public.discount_code_customers(customer_id);
CREATE INDEX idx_dcc_customer_auto ON public.discount_code_customers(customer_id)
  WHERE auto_apply = true;
```

**Semantics:**
- If a `discount_codes` row has **no rows** in this junction → code is universal (anyone can use)
- If it has rows → only listed customers can use the code (HARD restriction)
- Auto-apply flag per-junction-row → engine adds the code without explicit customer entry when that customer checks out

RLS: admin write only (`manage:discounts`). Customers can SELECT their own rows (so the storefront can preview "auto-apply" badges).

### 3.5 `affiliates` — new

```sql
CREATE TABLE public.affiliates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text,
  contact_phone   text,
  commission_rate numeric(5,4) NOT NULL DEFAULT 0,  -- 0.10 = 10%
  commission_type text NOT NULL DEFAULT 'percent_of_subtotal',
                  -- 'percent_of_subtotal' | 'flat_per_order'
  flat_commission numeric(10,2),                    -- when type=flat_per_order
  payout_method   text,                             -- free-form for v1
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (commission_type IN ('percent_of_subtotal','flat_per_order'))
);
```

### 3.6 `order_offer_applications` — audit trail (CRITICAL)

```sql
CREATE TABLE public.order_offer_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  offer_id        uuid NOT NULL REFERENCES public.offers(id) ON DELETE RESTRICT,
                  -- RESTRICT not CASCADE: offers used historically must
                  -- not be hard-deletable; soft-deactivate via active=false
  rule_id         uuid NOT NULL REFERENCES public.offer_rules(id) ON DELETE RESTRICT,
  code_id         uuid REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  affiliate_id    uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  amount_off      numeric(10,2) NOT NULL,
  currency        text NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ooa_order ON public.order_offer_applications(order_id);
CREATE INDEX idx_ooa_offer ON public.order_offer_applications(offer_id);
CREATE INDEX idx_ooa_affiliate ON public.order_offer_applications(affiliate_id) WHERE affiliate_id IS NOT NULL;
```

Source of truth for **what discount actually applied to which order**. Required for:
- Affiliate commission calculation
- ROI reporting per offer
- Dispute resolution ("why did this order get this discount?")
- Refund proration (when a returned item triggered a bundle)

### 3.7 `offer_customer_usage` — per-customer usage limit support

```sql
CREATE TABLE public.offer_customer_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  use_count   integer NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, customer_id)
);
CREATE INDEX idx_ocu_customer ON public.offer_customer_usage(customer_id);
```

Eliminates the need to count `order_offer_applications` rows for the "max N per customer" check on every order — that join would be expensive at scale.

---

## 4. Core library: `src/lib/offers/`

The offer-evaluation engine is the heart. Structured as pure functions where possible so it can run in any context (placeOrder, cart preview, storefront catalog query).

### 4.1 `evaluateOffersForCart` (the main entry point)

```ts
// src/lib/offers/evaluateOffersForCart.ts
export interface CartLineForEval {
  variant_id: string;
  product_id: string;
  category_ids: string[];
  quantity: number;
  unit_price: number;
}
export interface EvalContext {
  lines: CartLineForEval[];
  subtotal: number;
  itemCount: number;
  customerId: string | null;
  isAuthenticated: boolean;
  code: string | null;        // entered by the customer
  evaluationTime: Date;        // usually now()
  currency: string;
  inventoryByVariant: Map<string, number>;  // available stock
}
export interface AppliedOffer {
  offer_id: string;
  rule_id: string;
  code_id: string | null;
  affiliate_id: string | null;
  amount_off: number;          // positive number
  /** Per-line allocation — for VAT proration + refund handling */
  line_allocations: Array<{ variant_id: string; amount: number }>;
  /** Special: when this offer waives fees, the waiver kind + amount */
  fee_waiver: { kind: 'shipping'|'cod'|'all'; amount: number } | null;
}
export interface EvalResult {
  applied: AppliedOffer[];
  total_discount: number;
  total_fee_waiver: { shipping: number; cod: number };
  /** Helpful for storefront badge rendering */
  per_variant_discount: Map<string, { amount_off_per_unit: number; offer_id: string }>;
}

export async function evaluateOffersForCart(ctx: EvalContext): Promise<EvalResult>;
```

Algorithm (per-line aware, per decision #11):

1. **Load candidate offers** in one query — `active=true`, scope matches at least one cart line OR is `'all'`, **offer-level** conditionals pass (time, user_type, cart subtotal/item_count threshold, code requirement, usage limits).
2. **Per-line eligibility filter** — for each candidate offer, walk the cart lines and build the offer's `eligible_lines` subset:
   - Line's variant must be in the offer's resolved scope (variant ∈ scope_variant, variant.product ∈ scope_product, variant.categories ∩ scope_category, or scope='all')
   - If the offer has a **stock-threshold conditional**, the LINE's variant stock must satisfy it (`variant.stock_available ≤ stock_threshold`). For `stock_scope_kind='product'`, EACH variant of the named product is evaluated independently — only the variants currently below threshold qualify; the others are excluded from `eligible_lines` even if their product is in scope.
   - If `eligible_lines` is empty for this offer → skip the offer entirely.
3. **Compute amount_off per offer** based on its `eligible_lines` (NOT the whole cart). A percent-discount rule produces `sum(line.subtotal × discount_value)` over eligible lines; a flat-discount distributes pro-rata; a bundle rule counts trigger qty within eligible lines.
4. **Multi-code resolution** (per decision #12) — all codes the customer entered are loaded; each code points to an offer that gets evaluated independently. The set of eligible offers is the union of "auto-apply" offers + "code-required offers whose code was provided."
5. **Group by `kind`** (price discount / bundle / fee waiver). Apply each offer's `stacking_mode`:
   - `stack` — combine with everything else in the same kind
   - `exclusive_within_kind` — only this one wins within its kind (default)
   - `global_exclusive` — wins outright; everything else dropped
6. **Resolve cross-group competition** when stacking conflicts using `priority` then best-for-customer (deepest absolute discount).
7. **Allocate the discount per line** for audit trail (pro-rata by line subtotal across eligible lines; bundle reward goes 100% to reward lines).
8. **Return `EvalResult`** with applied offers + per-line allocations.

The per-line eligibility step is what makes "this offer applies to some lines but not others in the same cart" possible — critical for stock-threshold rules where one variant is qualifying and a sibling isn't.

### 4.2 `evaluateOffersForCatalog` (storefront — auto-apply only)

```ts
// src/lib/offers/evaluateOffersForCatalog.ts
/**
 * Variant-level price computation for the storefront. Returns each
 * variant's display price + original price (for crossed-out rendering)
 * + the offer that applied.
 *
 * Scope: ONLY auto-apply offers (requires_code=false) — code-bearing
 * offers must not leak prices to the storefront.
 *
 * Performance: hits the same offers query as evaluateOffersForCart but
 * scoped per variant; results cached per request via React.cache().
 */
export async function evaluateOffersForVariantSet(
  variantIds: string[],
  ctx: { evaluationTime: Date; currency: string; inventoryByVariant: Map<string, number> }
): Promise<Map<string, { effective_price: number; original_price: number; offer_id: string | null }>>;
```

This wraps the catalog tile + product detail price computation.

### 4.3 `loadCandidateOffers` (the SQL query)

A single Postgres function that returns offers eligible for an evaluation context. Encapsulates the WHERE clause complexity:

```sql
CREATE OR REPLACE FUNCTION public.eligible_offers(
  p_now            timestamptz,
  p_user_type      text,        -- 'authenticated' | 'guest'
  p_customer_id    uuid,
  p_code           text,
  p_subtotal       numeric,
  p_item_count     integer,
  p_variant_ids    uuid[],
  p_product_ids    uuid[],
  p_category_ids   uuid[]
) RETURNS SETOF public.offers
```

Returns offers where ALL the following hold:
- `active=true`
- `starts_at IS NULL OR starts_at <= p_now`
- `ends_at IS NULL OR ends_at > p_now`
- `user_type = 'any' OR user_type = p_user_type`
- `min_subtotal IS NULL OR p_subtotal >= min_subtotal`
- `min_item_count IS NULL OR p_item_count >= min_item_count`
- `max_uses_total IS NULL OR current_uses < max_uses_total`
- Per-customer usage limit not exceeded (left-join `offer_customer_usage`)
- Code requirement satisfied (either `requires_code=false` OR matching code provided)
- At least one scope row matches (or `scope_kind='all'`)
- Stock threshold OK (left-join `inventory_items`)

Returning a single `SETOF offers` keeps the JS side simple.

### 4.4 Discount allocation per line

For audit trail + refund proration, every applied discount needs **per-line allocation**:

```ts
// Algorithm: pro-rata by line subtotal.
// e.g., €100 discount across two lines €60 + €40 → €60 to line 1, €40 to line 2.
// Bundle rule: full discount allocated to the reward line(s) only.
// Fee waiver: NOT allocated to lines (it's a separate fees_breakdown adjustment).
```

---

## 5. Integration points

### 5.1 `placeOrder.ts` — the authoritative pricing moment

Replace lines 591-597:

```ts
// BEFORE:
const taxAmount = 0;
const discountAmount = 0;
const total = round2(subtotal + feesTotal + taxAmount - discountAmount);

// AFTER:
const offerEval = await evaluateOffersForCart({
  lines: lines.map(l => ({
    variant_id: l.variant_id, product_id: l.product_id,
    category_ids: categoryIdsByProduct.get(l.product_id) ?? [],
    quantity: l.quantity, unit_price: l.unit_price,
  })),
  subtotal,
  itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  customerId: customer.id,
  isAuthenticated: customer.is_anonymous === false,
  code: parsed.data.discount_code ?? null,
  evaluationTime: new Date(),
  currency: 'EUR',
  inventoryByVariant: await loadAvailability(variantIds),
});
const discountAmount = offerEval.total_discount;
const shippingWaiver = offerEval.total_fee_waiver.shipping;
const codWaiver = offerEval.total_fee_waiver.cod;

// Adjust the fees_breakdown the customer is charged:
// each waived category's `charged` becomes 0; api_quote stays for accounting.
const adjustedFeesBreakdown = applyFeeWaivers(feeResult.fees_breakdown, offerEval);
const adjustedFeesTotal = adjustedFeesBreakdown.reduce((s, b) => s + b.charged, 0);

const taxAmount = 0;  // still placeholder until VAT phase lands
const total = round2(subtotal + adjustedFeesTotal + taxAmount - discountAmount);
```

Then **after** `commit_order_with_lines` returns, insert the audit rows:

```ts
await admin.from('order_offer_applications').insert(
  offerEval.applied.map(a => ({
    order_id: result.order_id,
    offer_id: a.offer_id,
    rule_id: a.rule_id,
    code_id: a.code_id,
    affiliate_id: a.affiliate_id,
    amount_off: a.amount_off,
    currency: 'EUR',
  }))
);
// Increment usage counters (atomic; use SQL function)
await admin.rpc('record_offer_usage', {
  p_offer_ids: offerEval.applied.map(a => a.offer_id),
  p_customer_id: customer.id,
});
```

`record_offer_usage` is a single SQL function that atomically increments `offers.current_uses` AND upserts `offer_customer_usage(use_count = use_count + 1)`. Avoids round-trip overhead for offers with multiple rules applied to the same order.

### 5.2 Cart page — preview pricing

The cart page already fetches cart lines + computes subtotal. Wrap that with `evaluateOffersForCart` (auto-apply offers only, code optional from URL/state) and render the discount line(s) inline.

Currently the cart structure shows: items + subtotal + (later) total. The offer engine produces:
- A list of "applied offers" to display: "✓ Black Friday Bundle: -€15"
- A revised total

Cart prices are **advisory** — final price is computed at `placeOrder`. Cart shows a banner like "Discount applies at checkout" when relevant.

### 5.3 Storefront — crossed-out prices + badges

Three render sites need wiring:

**Site A: Catalog tile** ([products/page.tsx](src/app/(storefront)/products/page.tsx))

Currently:
```tsx
<Price amount={Number(card.variant.price)} currency={card.product.currency} />
```

After:
```tsx
{card.original_price !== card.variant.price && (
  <span className="line-through text-muted-foreground mr-2">
    <Price amount={card.original_price} currency={card.product.currency} />
  </span>
)}
<Price amount={Number(card.variant.price)} currency={card.product.currency} />
{card.offer_badge && <OfferBadge offer={card.offer_badge} />}
```

`searchVariants` (the server function feeding the catalog) extends to call `evaluateOffersForVariantSet` and decorate each card with `{ effective_price, original_price, offer_badge }`.

**Site B: Product detail page** ([products/[slug]/page.tsx](src/app/(storefront)/products/%5Bslug%5D/page.tsx))

`getProductBySlug` extends similarly. The page already computes `variantPriceLabels` from raw `variant.price`; that becomes `variantEffectivePriceLabels` + `variantOriginalPriceLabels`.

`ProductDetailInteractive` renders the crossed-out + effective pair next to the dynamic title:

```tsx
<div className="space-y-1">
  {originalLabel !== priceLabel && (
    <p className="text-muted-foreground line-through text-sm">{originalLabel}</p>
  )}
  <p className="text-xl">{priceLabel}</p>
</div>
```

**Site C: Variant picker chips**

Each chip can show "€19,90" or "€19,90 (was €24,90)". Already controlled by `variantEffectivePriceLabels` so wiring is one-line.

### 5.4 Refund flow integration (decision #13)

Currently `refundOrder` reverses payment and updates the order status. Under the new offers model it ALSO needs to re-evaluate the engine against the post-return cart and adjust the refund amount accordingly — because applied offers may dissolve when their trigger conditions stop holding.

**Refund formula:**

```
refund_amount = old_total_paid - new_total_owed_after_return

where:
  old_total_paid       = the original orders.total
  new_total_owed_after_return = evaluate(remaining_lines).subtotal
                              + adjusted_fees
                              + adjusted_tax
                              − evaluate(remaining_lines).total_discount
```

The engine is called with a synthetic `EvalContext` reflecting the post-return cart state. If the remaining lines no longer satisfy a rule's trigger condition (e.g., bundle's `trigger_quantity` falls short), that rule produces `amount_off = 0` and is dropped from `applied` — its previous allocation is implicitly reversed because the new evaluation simply doesn't include it.

**Why this works cleanly:**
- It's a single function call, not a tangle of per-rule reversal logic.
- The `order_offer_applications` audit trail preserves the original allocation, so refunds can be audited end-to-end.
- The math handles all rule types uniformly — bundle, percent, flat, fee waiver — without per-kind special-casing.

**Admin UX:**

The refund preview UI shows three lines:
```
Επιστροφή στοιχείων:    -€100,00   (returned items at their list price)
Επανυπολογισμός προσφοράς:  -€10,00   (proportional discount being clawed back)
─────────────────────────────────────
Καθαρή επιστροφή:         €70,00   ← what the customer actually gets refunded
```

Below this, an **"Παράκαμψη ποσού"** (override) field lets the admin manually set the refund amount for goodwill exceptions ("the customer was happy until you took the discount away — let's just give them the €100"). The override is logged to the audit_log table.

**Refund flow** (new function — `previewRefund` server action):

```ts
1. Load the original order + order_offer_applications + order_items
2. Build a "remaining_lines" cart from order_items minus the items being returned
3. Call evaluateOffersForCart(remaining_lines, original context preserved)
4. Compute new_total_owed_after_return = subtotal + adjusted_fees + adjusted_tax - new_discount
5. Refund amount = orders.total - new_total_owed_after_return
6. Return { suggested_refund, eligible_offers_after_return, breakdown_lines } to the admin UI
```

The refundOrder action then accepts an optional `override_amount` from the admin; if absent, uses the calculated value.

**Edge case — BOGO with consumed free item:** customer returns 1 of the 2 paid items in a "buy 2 get 1 free" bundle. Engine re-evaluates → no trigger → the previously-free item is no longer free. Net refund could be €0 (or even an additional charge owed, which the system refuses). The admin override is essential here — they can charge for the previously-free item separately or accept a goodwill loss.

### 5.5 Storefront badge tokens

A small library: `src/lib/offers/badges.ts`

Maps offer/rule to badge shape:

| Rule kind | Badge label (Greek) | Color token |
|---|---|---|
| `percent_discount` | "−20%" (label = `-${value*100}%`) | `--badge-discount` |
| `flat_discount` | "−€5" (label = currency-formatted) | `--badge-discount` |
| `bundle_bxgy` | "2 + 1 ΔΩΡΟ" | `--badge-bundle` |
| `waive_shipping` | "ΔΩΡΕΑΝ ΑΠΟΣΤΟΛΗ" | `--badge-shipping` |
| `waive_cod` | "ΧΩΡΙΣ ΕΞΟΔΑ ΑΝΤΙΚΑΤ." | `--badge-cod` |
| Stock-conditional | "ΤΕΛΕΥΤΑΙΑ ΤΕΜΑΧΙΑ" | `--badge-low-stock` |

CSS tokens defined in `globals.css` alongside the existing badge palette.

A `<OfferBadge offer={...} />` client component renders the appropriate label + colour for a given rule.

---

## 5.6 Security: RBAC defense in depth (decision #14)

The offers engine controls real money flow. Every write path is guarded at **four independent layers**; any single layer being bypassed must not be sufficient to apply unauthorized discounts.

**Layer 1 — RLS policies on every offers table**

```sql
-- Every table follows the same template, only resource permission varies
CREATE POLICY "offers_admin_write"
  ON public.offers FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "offers_read_public_active"
  ON public.offers FOR SELECT TO anon, authenticated
  USING (active = true AND requires_code = false);
CREATE POLICY "offers_read_admin_all"
  ON public.offers FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));
```

Same pattern on `offer_scopes`, `offer_rules`, `discount_codes`, `discount_code_customers`, `affiliates`, `order_offer_applications`, `offer_customer_usage`. Public SELECT is restricted to "active AND not code-required" so the storefront only sees auto-apply offers; admins see everything.

**Layer 2 — `checkPermission()` in every server action**

Every write action starts with:
```ts
if (!(await checkPermission("manage:discounts"))) {
  return fail("Forbidden", "FORBIDDEN");
}
```
This catches the case where someone calls the action with valid auth but no `manage:discounts` permission (RLS would also catch it, but checkPermission gives a clean error message instead of a SQL constraint violation).

**Layer 3 — Mandatory audit logging**

Every CUD operation calls `logAuditEvent`:
```ts
await logAuditEvent({
  actor_id: authData.user.id,
  actor_type: "user",
  action: "offer.created" | "offer.updated" | "offer.deactivated" | ...,
  resource_type: "offer",
  resource_id: offer.id,
  metadata: { /* before/after diff */ },
});
```

Even if RLS + checkPermission are both somehow bypassed, the audit log creates a forensic trail. Audit log writes are themselves RLS-protected to be append-only.

**Layer 4 — UI guards via `<RequirePermission>`**

Every admin form/button that mutates offers wraps:
```tsx
<RequirePermission permission="manage:discounts">
  <button onClick={createOffer}>Νέα προσφορά</button>
</RequirePermission>
```

UI guards are the weakest layer (a savvy attacker bypasses the client), but they prevent honest mistakes by users who shouldn't see those buttons.

**Engine read path** is intentionally NOT guarded — the storefront catalog must compute auto-apply prices for anonymous visitors. RLS handles this (public SELECT restricted to safe offers).

**The `record_offer_usage` RPC** runs `SECURITY DEFINER` (it must update counters) but performs its own internal permission gate — the only legitimate caller is `placeOrder` running under the admin client, so the RPC verifies the caller is using `service_role`.

---

## 5.7 Race-condition defenses (decisions #15, #16)

This is the **hardest** part of the engine and the most likely source of bugs. The existing oversell/contention architecture handles stock races; the offers engine must compose with it cleanly and add its own state-management on top.

### 5.7.1 Effective stock evaluation (decision #15)

Stock-threshold rules **never read raw `inventory_items.quantity_available`**. They go through `getContestableAvailable` (already exists in `src/lib/inventory/`), which returns:

```
effective_available = quantity_available
                    − quantity_reserved          (orders awaiting fulfillment)
                    − sum(active_soft_holds)     (other carts in checkout)
```

So when User A soft-holds the last unit of a variant that triggers a "while ≤ 3 left" rule (effective stock drops from 4 to 3), User B opening the cart immediately sees the offer **active** for that variant. When User A's session times out (soft hold released), effective stock returns to 4, and User B's next eval sees the offer go **inactive** again. This matches the existing contention semantics — operators learn one mental model that applies everywhere.

### 5.7.2 Offer snapshot lock at checkout intent (decision #16)

The hardest race: a customer puts items in their cart with a discount applied, opens the Stripe checkout, and the offer becomes ineligible mid-flow (date expires, another order drops effective stock above threshold, the offer's `max_uses_total` hits its hard cap). Without a lock, Stripe completes the payment, the webhook fires, and `placeOrder` re-evaluates → finds no discount → customer is charged full price for the items they thought they were buying at a discount.

**The lock:**

`cart_checkout_sessions` gets a new column:
```sql
ALTER TABLE public.cart_checkout_sessions
  ADD COLUMN offer_snapshot jsonb;
```

The snapshot is written **once** when the customer transitions from cart-state to checkout-intent:
- For non-Stripe (COD): when they click "Place Order"
- For Stripe: when the Stripe Checkout Session is created (call to `stripe.checkout.sessions.create`)

The snapshot has the full shape of `EvalResult.applied[]` — every offer that was eligible at that moment, with its `amount_off`, `rule_id`, `code_id`, `affiliate_id`, and `line_allocations`. The snapshot also captures:
- `evaluated_at timestamptz` — when the lock was taken
- `subtotal_at_lock numeric` — for sanity-checking
- `code_set text[]` — the codes that were applied (so re-eval can reconstruct context)

For Stripe, the snapshot is ADDITIONALLY written to the Stripe Checkout Session's `metadata.offer_snapshot` field (serialized) so the webhook can read it even if the session row is stale or has been GC'd.

**At placeOrder time:**

The engine call is bypassed when a valid snapshot exists. Instead:
```ts
const snapshot = cartSession.offer_snapshot;
if (snapshot && isSnapshotValid(snapshot, evaluationTime)) {
  // Use the snapshot's amount_off etc. verbatim
  discountAmount = snapshot.applied.reduce((s, a) => s + a.amount_off, 0);
  // ... audit insert uses snapshot's applied[] verbatim
} else {
  // No snapshot or invalid (e.g., expired far past sane TTL like 1h)
  // → re-evaluate
  const eval = await evaluateOffersForCart(ctx);
  // ...
}
```

`isSnapshotValid` checks:
- `evaluated_at` is within a sane TTL (e.g., 2h — enough for a slow Stripe checkout, not enough to be exploited)
- `subtotal_at_lock` matches the current cart subtotal (prevents "lock at €100, modify cart to €5000, get the same flat discount" exploits)

**Soft hold + snapshot interaction:**

When a snapshot is written, the cart's soft holds are upgraded to **hard reservations**. This is critical: the snapshot guarantees the offer applies; the hard reservation guarantees the inventory is there. Both must succeed together or both fail.

### 5.7.3 Scenarios + defenses

Five concrete races covered:

**Scenario A: User A holds the last unit; User B sees the wrong offer state**

- T0: stock = 4, threshold = 3, offer inactive (4 > 3)
- T1: User A adds 1 to cart → soft hold → effective stock = 3 → offer becomes active for User A
- T2: User B opens product page → cached page shows wrong price (still inactive)
- T3: User B adds 1 to cart → `evaluateOffersForCart` re-evals with current effective stock = 2 (now A holds 1, B holds 1) → offer active for User B too

**Defense**: cart-add is the re-eval boundary. Storefront stale prices are an acceptable display lag because the authoritative eval happens on every cart mutation.

**Scenario B: Stripe session opened with offer; offer expires before payment**

- T0: customer opens Stripe checkout at 23:55 with "Black Friday: -10%" applied
- T1: clock hits midnight, offer's `ends_at` passes
- T2: customer completes payment at 00:05; webhook fires
- T3: `placeOrder` reads `offer_snapshot` from session metadata → applies the -10% from the snapshot, NOT a fresh evaluation

**Defense**: snapshot lock (5.7.2). The offer was eligible at intent time; that's the binding moment.

**Scenario C: Two carts compete for the last "stock ≤ 3" unit**

- T0: stock = 4, threshold = 3, offer inactive
- T1: User A snapshots (intent moment) with effective stock = 3 (1 reserved by someone earlier) → offer active in snapshot
- T2: User B snapshots concurrently with effective stock = 3 → also active in snapshot
- T3: Both proceed to placeOrder; both get the discount

**Defense**: snapshot binds the offer applicability AT INTENT, not at completion. Both users get the discount. The inventory race (whether User A or B actually gets the unit) is handled by the existing oversell-contention flow — one of them gets `INSUFFICIENT_STOCK` at placeOrder and the offer dissolves with the rest of the cart. The offer engine doesn't need to know about this; it follows inventory.

**Scenario D: Soft hold released after snapshot but before completion**

- T0: User A snapshots with offer active (because of their own soft hold pushing stock below threshold)
- T1: User A's soft hold times out (session inactive)
- T2: User A returns → tries to proceed to payment → snapshot is still valid

**Defense**: the snapshot is valid for the TTL window regardless of soft hold state. If the snapshot becomes too old (>2h) the customer is sent back through the cart flow and re-evaluated. Soft hold expiry doesn't auto-invalidate the snapshot (the snapshot is its own reservation contract).

**Scenario E: Admin deactivates the offer mid-flow**

- T0: admin clicks "Deactivate" on an active offer
- T1: 5 customers have active snapshots with that offer
- T2: customer 1 completes → snapshot honored → discount applies
- T3: customer 2 still in checkout → no change to their snapshot → discount applies on completion

**Defense**: snapshots are the source of truth post-intent. Deactivating an offer prevents NEW snapshots from including it; existing snapshots stand. This matches admin intuition ("turn off the offer for new customers; don't strip it from people I already told 'yes' to").

### 5.7.4 The cost of getting this wrong

Without the snapshot lock, the symptom is: customer sees a discount on the cart page, sees the same discount on the Stripe checkout summary, completes payment, and is charged a different amount because the offer re-evaluated between intent and webhook. This is **the worst possible bug class** — it produces successful but wrong-amount charges + chargebacks. The snapshot is mandatory infrastructure for this engine.

---

## 6. Admin UI

The existing `/admin/discounts` page becomes `/admin/offers`. URL stays `/admin/discounts` to preserve the sidebar link (already renamed to "Προσφορές").

### 6.1 List view

Replaces the current single-table CRUD with a richer list:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [+ Νέα προσφορά]                                  Search: [_______]  │
├──────────────────────────────────────────────────────────────────────┤
│ ✓ Black Friday 2025                          Active │ -20% Toys      │
│   Code: BLACKFRIDAY · 142/500 uses · expires Nov 30                  │
├──────────────────────────────────────────────────────────────────────┤
│ ✓ Δωρεάν Αποστολή > €50                       Active │ Shipping      │
│   Auto-apply · 1,238 uses                                            │
├──────────────────────────────────────────────────────────────────────┤
│ ○ Καλοκαιρινές 2024                       Inactive │ -15% multi      │
│   Expired Sep 15 · 87 uses                                           │
└──────────────────────────────────────────────────────────────────────┘
```

Each row links to the offer-detail page.

### 6.2 Offer detail page (the main edit surface)

Tabs: **Επισκόπηση / Κανόνες / Πεδίο εφαρμογής / Κωδικοί**

**Επισκόπηση tab** — offer-level conditionals:
- Name, description, active toggle
- Timeframe (date picker pair, both optional)
- User type radio (any / authenticated / guest)
- Stacking mode radio
- `min_subtotal`, `min_item_count`
- `max_uses_total`, `max_uses_per_customer`
- Stock threshold builder (variant or product picker + threshold number)
- "Requires code" toggle (if true, switches to Κωδικοί tab to create one)

**Κανόνες tab** — rule list with [+ Add rule] button. Each rule expands into a kind-specific form:
- Percent discount: just a percent value
- Flat discount: amount + currency
- Bundle: trigger picker + quantity + reward picker + quantity + max applications
- Waive shipping/cod/all: threshold kind + value + customer-charge toggle

**Πεδίο εφαρμογής tab** — multi-select of categories/products/variants OR "Όλο το κατάστημα" toggle.

**Κωδικοί tab** — list of `discount_codes` rows for this offer + [+ Add code] button:
- Code (auto-generated or admin-typed)
- Affiliate (dropdown from `affiliates` table; optional)
- Active toggle

### 6.3 Affiliates admin

New page `/admin/affiliates`:
- List of affiliates with active toggle + per-affiliate stats: code-count, total revenue, commission earned
- Detail: name + contact + commission terms + payout method
- Per-affiliate "Codes" tab: their associated `discount_codes` rows
- Per-affiliate "Orders" report: list of orders attributed via their codes + commission rollup

Sidebar location: "Marketing" group (alongside "Προσφορές").

---

## 7. Storefront customer entry point — code field

Currently checkout has no code field. Add a "Έχετε κωδικό προσφοράς;" collapsible at checkout above the totals block — supporting **multiple codes** per decision #12:

```
[Έχετε κωδικό προσφοράς; ▼]
   ┌────────────────────┐ ┌──────────┐
   │ Code: ________     │ │ Προσθήκη │
   └────────────────────┘ └──────────┘

   Εφαρμοσμένοι κωδικοί:
     ✓ BLACKFRIDAY  → Black Friday 2025: −€15    [✕]
     ✓ FREESHIP     → Δωρεάν Αποστολή: −€4,90    [✕]
```

The form submits one code at a time; each entry adds to the applied set. Pressing the [✕] removes a code. Each "Προσθήκη" re-evaluates the engine across all currently-applied codes + auto-apply offers; the result updates the totals block live. Invalid/expired/ineligible codes show an inline error and aren't added to the list.

**Per-cart code storage:** the applied codes array lives in the cart session (`cart_checkout_sessions.applied_codes jsonb`). It's an array of strings, capped at a sensible limit (e.g., 10 codes) to defend against UI abuse. `placeOrder` reads from this field and passes the array into `evaluateOffersForCart`.

**Stacking control stays with the admin:** if the admin wants to refuse multi-code stacking on a specific offer, they set its `stacking_mode = 'global_exclusive'` — the engine then drops every other applied offer when that one is in the eligible set. The platform never refuses a second code at the input layer.

**Affiliate-URL auto-apply**: a Phase 7 enhancement adds `?ref=CODE` URL handling. Middleware reads the param, appends it to the cart's applied_codes array on first visit, and the checkout code field reflects it via the same code-list UI above.

---

## 8. Phased rollout

Each phase ships independently and is testable end-to-end.

### Phase 1 — Schema migrations + library skeleton (1-2 days)

- Migration 1: create `offers`, `offer_scopes`, `offer_rules`, `affiliates`, `order_offer_applications`, `offer_customer_usage`
- Migration 2: drop legacy `discount_codes` + `discount_usage`, recreate `discount_codes` with the new shape
- Migration 3: backfill — convert existing `discount_codes` rows into `offers` + `offer_rules` + new `discount_codes`
- Library skeleton: `src/lib/offers/{evaluateOffersForCart, evaluateOffersForVariantSet, types}.ts`
- The `eligible_offers` SQL function

**Deliverable**: schema in place, library types stable, no runtime behavior change yet (offers table empty post-backfill = no offers apply, equivalent to current "no discounts" state).

### Phase 2 — Engine implementation + admin CRUD (3-4 days)

- Implement `evaluateOffersForCart` with **percent_discount** + **flat_discount** rule kinds only
- Implement `evaluateOffersForVariantSet` for storefront
- Admin: rebuild `/admin/discounts` as the new offer-list view + offer-detail edit page (Επισκόπηση + Κανόνες + Πεδίο εφαρμογής + Κωδικοί tabs)
- All server actions: `createOffer`, `updateOffer`, `deleteOffer`, `addOfferRule`, `updateOfferRule`, `removeOfferRule`, `setOfferScopes`, `createDiscountCode`, `deleteDiscountCode`

**Deliverable**: admin can create + manage offers with discount rules; the engine returns the right amount_off for any cart context — but it's not wired into checkout yet.

### Phase 3 — Storefront integration (1-2 days)

- Wire `evaluateOffersForVariantSet` into `searchVariants` (catalog) + `getProductBySlug` (PDP)
- Render crossed-out prices in catalog tile + PDP
- `OfferBadge` component + `badges.ts` token map
- Catalog filter: optional "Σε προσφορά" filter

**Deliverable**: customers see discounted prices + badges for any active auto-apply offer.

### Phase 4 — Checkout integration + snapshot lock (3-4 days)

- Replace `discountAmount = 0` in `placeOrder.ts` with snapshot-aware logic
- Add `cart_checkout_sessions.offer_snapshot jsonb` column (migration)
- Implement snapshot write at intent moment (in cart→checkout transition + Stripe Checkout Session creation)
- Implement `isSnapshotValid` (TTL + subtotal sanity check)
- Stripe webhook handler reads `metadata.offer_snapshot` and applies it
- Add multi-code-entry chip-builder UI at checkout (decision #12)
- `cart_checkout_sessions.applied_codes jsonb` column + maintenance
- Wire applied-offer audit insert + atomic usage counter increment (`record_offer_usage` RPC)
- Update cart page to show offer line items
- Migrate the existing `applyDiscount` action body to use the new engine (keep the action exported so existing UI calls don't break)

**Deliverable**: end-to-end discount application at checkout with full snapshot-lock semantics; Stripe sessions honor the offer they were created with; full audit trail on `order_offer_applications`.

### Phase 5 — Bundle (BXGY) rule (2-3 days)

- Extend `evaluateOffersForCart` with bundle logic (greedy application + per-application allocation)
- Inventory reservation: bundle reward inventory must be reserved in `placeOrder.ts` alongside the trigger items
- Admin UI: bundle rule form
- Edge case: refund/return of trigger or reward — Phase 5b separate sub-feature: write a `bundle_dissolve_on_refund` policy

**Deliverable**: BOGO offers work end-to-end.

### Phase 6 — Service-fee waiver rules (1-2 days)

- Extend engine with `waive_shipping`, `waive_cod`, `waive_all_fees` kinds
- Adapt `fees_breakdown` in placeOrder: waived rows keep `api_quote` for accounting; `charged` becomes 0
- Update order-detail UI to show "Free shipping applied" + the absorbed cost
- Admin UI: waiver rule form

**Deliverable**: "Free shipping over €50" + "No COD fee for first-time customers" type offers.

### Phase 7 — Stock-threshold + customer whitelist + affiliates + refund proration (4-5 days)

- Extend `eligible_offers` SQL to call `getContestableAvailable` for stock check (decision #15); implement per-line eligibility filter (per decision #11)
- Per-variant evaluation under `stock_scope_kind='product'` (each variant independently checked against the threshold)
- Admin UI: stock-threshold builder
- `discount_code_customers` junction (decision #18) + admin UI for assigning codes to specific customers + auto-apply flag
- Engine auto-apply path: when customer logs in, query `discount_code_customers WHERE auto_apply=true AND customer_id=X` and add those codes to the cart's `applied_codes` automatically
- Affiliates table + admin page
- Affiliate-attribution wiring in `discount_codes` + per-affiliate revenue report
- `?ref=CODE` URL auto-apply at storefront (middleware-level)
- Soft-warning UI for `max_uses_total` and `max_uses_per_customer` (decision #17) — admin sees banners but engine continues applying
- `enforce_limits` opt-in to flip to hard mode
- **Refund proration** (per decision #13):
  - `previewRefund` server action computing `refund = old_total − new_total_after_return`
  - Admin refund UI shows the breakdown + override field
  - `refundOrder` extends to accept `override_amount`
  - Audit log entry when the admin overrides the calculated amount

**Deliverable**: clearance offers, affiliate ROI reporting, customer-whitelisted codes, frictionless auto-apply for the affiliate audience, refund flow that respects offer dissolution.

### Phase 8 (deferred) — Polish

- Email notifications: offer-expiring digest, affiliate monthly statement
- Offer analytics dashboard (uses + revenue + ROI per offer)
- Multi-currency: discount values currency-aware
- VAT-on-discount integration (lands together with the broader VAT phase)
- Affiliate tiered commissions (decision #1 deferred)
- Affiliate self-service portal (decision #2 deferred)

---

## 9. Migration safety / backward compatibility

- Existing `applyDiscount` server action keeps its current call signature throughout the migration. Its body changes in Phase 4 to use the new engine.
- The existing `discount_codes` table is dropped + recreated, but the column names `code`, `active`, `created_at` are preserved. The legacy `type`/`value`/`usage_limit`/`expires_at` columns are migrated into the parent `offers` row.
- Legacy `discount_usage` → `order_offer_applications` (column shape change). Backfill copies rows with NULL `rule_id` (acceptable for historical data).
- Storefront stays unchanged through Phases 1-2 (no auto-apply offers exist yet during admin testing).
- Checkout `placeOrder.ts` modification is the SINGLE breaking change moment in Phase 4 — gated behind a feature flag (`OFFERS_ENGINE_ENABLED` env var). If flag off, falls back to `discountAmount=0`. Once verified, flag is removed.

---

## 10. Risks + open follow-ups

| Risk | Mitigation |
|---|---|
| **Engine performance**: storefront catalog needs offer eval on every variant of every page render | (1) `React.cache` the offer-fetch per request, (2) materialised view for "current active offer per variant" refreshed at 5-min intervals via the existing pg_cron infra, (3) DB index on `(scope_kind, resource_id)` covers the join |
| **Stacking complexity**: best-for-customer with `stack/exclusive_within_kind/global_exclusive` is non-trivial to test | Unit-test the engine against a fixture matrix of (offers × cart shapes) — ~50 cases; this catches most regressions before they hit prod |
| **Backfill correctness**: 3 legacy discount types → new shape | Backfill migration runs in a transaction; assertion at the end: `SELECT count(*) FROM offers WHERE … = count(*) FROM legacy_table` |
| **Refund proration**: when an item returns, the bundle/discount it triggered may need to be clawed back | In Phase 7 (per decision #13). Implementation is a single re-evaluation of the engine on the post-return cart + a refund formula of `old_total − new_total_after_return`. Admin override field handles goodwill exceptions. |
| **Currency on flat discounts**: a €5-off offer means different things for a US vs EU customer | Multi-currency phase (P8) addresses; v1 docs "discounts in store currency only" |
| **VAT interaction**: discount-pre-tax vs discount-post-tax | Coupled to broader VAT implementation; v1 stays VAT-agnostic since `taxAmount=0` placeholder remains |
| **Race in stock-threshold eval**: cart adds happening concurrently could blow past "while ≤ X" | Addressed in §5.7. Stock-threshold reads go through `getContestableAvailable` (contention-aware). Multiple snapshots at the boundary all honored — the inventory race is handled by the existing oversell flow, not the offers engine. |
| **Snapshot lock validity**: stale snapshot exploited to apply expired offer | TTL on `offer_snapshot.evaluated_at` (~2h); `subtotal_at_lock` sanity check rejects re-eval if cart subtotal diverged. Beyond TTL → snapshot invalidated, fresh eval runs. |
| **Stripe webhook arrives without session metadata**: customer rare-cases where the Stripe Checkout Session lost its metadata | Snapshot is ALSO stored in `cart_checkout_sessions.offer_snapshot`. Webhook reads from there as fallback when Stripe metadata is missing. |
| **RBAC bypass at any single layer**: someone hits a server action directly with valid auth but no `manage:discounts` permission | 4-layer defense (§5.6): RLS + checkPermission + audit log + UI guards. Any single layer bypassed is caught by the next. |
| **Auto-apply code leak**: customer A discovers customer B's whitelisted code and tries to use it | `discount_code_customers` HARD check at engine eval — code rejected for non-whitelisted customer even if entered. RLS prevents customer A from seeing the whitelist directly. |
| **Offer with no rules**: should be impossible | CHECK constraint OR application validation: refuse to set `active=true` on an offer with zero `offer_rules` |

---

## 11. What gets built first (Phase 1 deliverable in detail)

To make this actionable immediately, here is the literal Phase-1 file list:

1. `supabase/migrations/<ts>_offers_engine_schema.sql` — creates the 6 new tables + RLS + indexes
2. `supabase/migrations/<ts>_offers_engine_backfill.sql` — converts legacy discount_codes rows
3. `supabase/migrations/<ts>_offers_engine_drop_legacy.sql` — drops legacy tables (separate migration so it can be reverted easily)
4. `supabase/migrations/<ts>_eligible_offers_function.sql` — the SQL function
5. `supabase/migrations/<ts>_record_offer_usage_function.sql` — atomic usage-counter increment
6. `src/types/offers.ts` — TypeScript shapes for `Offer`, `OfferRule`, `OfferScope`, `Affiliate`, `DiscountCode`, `OrderOfferApplication`, plus the engine's `EvalContext`/`EvalResult`
7. `src/lib/offers/index.ts` — barrel exports (skeletal in Phase 1)
8. `src/lib/offers/evaluateOffersForCart.ts` — function signature only, body throws "not implemented"
9. `src/lib/offers/evaluateOffersForVariantSet.ts` — same
10. `src/lib/offers/loadCandidateOffers.ts` — wraps the SQL function

Phase 1 doesn't touch any user-facing file. It only adds the foundation.

---

## 12. Estimated effort

| Phase | Days | Notes |
|---|---|---|
| 1 — Schema + skeleton + RBAC | 2-3 | Schema includes 4-layer RBAC scaffolding (decision #14) from day one |
| 2 — Engine + admin CRUD (per-line eligibility from day 1) | 3-4 | The biggest chunk |
| 3 — Storefront wiring | 1-2 | Auto-apply offers visible |
| 4 — Checkout integration + snapshot lock | 3-4 | Multi-code chip UI + offer_snapshot jsonb + Stripe metadata wiring |
| 5 — Bundle (BXGY) | 2-3 | Inventory edge cases |
| 6 — Fee waivers | 1-2 | |
| 7 — Stock threshold + customer whitelist + affiliates + refund proration | 4-5 | Heaviest after Phase 2 — race-condition tests, snapshot-aware refund, affiliate report |
| **Total v1** | **16-23 days** | Phaseable; each phase ships value |

Phase 8 (analytics, email, multi-currency, VAT integration, affiliate tiers, affiliate portal) remains deferred until specific business needs surface.
