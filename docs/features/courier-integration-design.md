# Courier Integration Design

Living design document for the multi-carrier shipping/pickup system. Captures
every decision discussed so far, what's in the codebase today, what's designed
but not built, what's still ambiguous, and the full implementation plan.

When a decision changes, edit this first, then sync the code.

---

## Table of Contents

1. [Glossary](#glossary)
2. [Carrier model: three buckets](#carrier-model-three-buckets-and-the-visibility-axis)
3. [Carrier capabilities by API](#carrier-capabilities-what-each-api-can-do)
4. [Compatibility rules](#compatibility-rules-delivery--payment--carrier)
5. [API capability granularity](#api-capability-granularity)
6. [Status vocabulary](#status-vocabulary)
7. [Tracking model](#tracking-model)
8. [Caching strategy](#caching-strategy-by-data-type)
9. [Provider abstraction](#provider-abstraction)
10. [Admin configuration model](#admin-configuration-model)
11. [Current implementation state](#current-implementation-state)
12. [Open questions](#open-questions)
13. [Implementation plan](#implementation-plan)
14. [Architecture decision records](#architecture-decision-records)
15. [File-level map](#file-level-map)
16. [API glossary](#api-glossary)

---

## Glossary

Customer-facing Greek labels for the delivery method enum:

| Code | Greek label | Meaning |
|---|---|---|
| `home_delivery` | Παράδοση στο σπίτι | Courier delivers to customer's address |
| `store_pickup` | Παραλαβή από το κατάστημα | Customer collects from OUR vendor store, no carrier involved |
| `delivery_station_pickup` | Παραλαβή από locker / Smart Point | Unattended self-service collection (BoxNow Σταθμός, ACS Smartpoint, ELTA APM, etc.) |
| `carrier_pickup` | Παραλαβή από κατάστημα μεταφορικής | Staffed carrier branch (ACS central store, ELTA branch, etc.) |

The "σταθμός" in `delivery_station_pickup` specifically means an automated
locker (BoxNow's terminology), not a courier depot.

---

## Carrier model: three buckets and the visibility axis

The system models carriers in **three distinct buckets**, all valid, with two
orthogonal axes governing their behavior:

- **Visibility** — does the customer see this carrier at checkout? (admin choice)
- **API integration depth** — how much of this carrier's API does the app use?
  (only meaningful for carriers with a provider class in code; per-capability config)

These are independent. A carrier can be visible without any API. A carrier can
have an API integration toggled off (not visible). Mix-and-match is fully
supported.

### The three buckets

| Bucket | Example | Visible at checkout? | API capabilities | Pricing source |
|---|---|---|---|---|
| **API-integrated** | ACS (full setup) | Admin toggles | Per-capability config (see [API capability granularity](#api-capability-granularity)) | Mixed: API quote OR custom rules per fee category |
| **Built-in, not API-integrated** | Speedex (no API yet, but admin wants to offer it) | Admin toggles | n/a (no provider class active) | Custom rules only. Vouchers handled manually in the carrier's portal. |
| **Custom** (admin-created) | "Παράδοση δικιά μας" | Admin toggles | n/a (no provider class exists) | Custom rules only. Merchant fulfils entirely manually. |

The fee resolver does not branch on bucket. Custom rules always apply. API
quotes only fire for bucket-1 carriers with `fetch_price_quote` capability
enabled. Everything else gets custom rules.

### Carriers move from enum to data

Today the `CARRIERS` const in [`src/config/storefront.ts`](src/config/storefront.ts)
is a literal union — the universe of valid carrier slugs is compile-time fixed:

```ts
export type CarrierValue = "acs" | "elta" | "box_now" | "speedex" | "geniki" | "other";
```

Custom carriers can't fit into a static enum. The carrier list becomes a
DB-backed table:

```sql
create table delivery_carriers (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,            -- 'acs', 'custom_van_abc123', etc.
  display_name    text not null,                   -- 'ACS', 'Παράδοση δικιά μας'
  supported_delivery_methods text[] not null,      -- ['home_delivery', 'carrier_pickup', ...]
  is_active       boolean not null default false,  -- visible at checkout
  is_custom       boolean not null default false,  -- true = admin-created
  display_order   int not null default 0,
  tracking_url_template text,                      -- e.g. 'https://acs.gr/track?p={voucher}'
  timeline_preset text,                            -- references status timeline (see Status vocabulary)
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

**Seeded built-ins** ship as `is_custom=false`. Admin can toggle `is_active` but
can't delete or rename them (they're tied to provider classes by slug).

**Custom carriers** are full CRUD by the admin.

For built-in carriers, `supported_delivery_methods` is editable down to the
provider's structural ceiling. The admin can disable ACS branch pickup if they
don't offer it; they can't enable a method the provider class doesn't support
(BoxNow can never gain home delivery, regardless of admin wish).

### TypeScript type system

The literal union becomes a string type, with a narrow type for built-ins where
runtime behavior is hardcoded:

```ts
export type BuiltInCarrierSlug =
  | "acs" | "elta" | "box_now" | "speedex" | "geniki" | "other";

export type CarrierSlug = string;  // built-in OR custom

export function isBuiltInCarrier(slug: string): slug is BuiltInCarrierSlug {
  return ["acs", "elta", "box_now", "speedex", "geniki", "other"].includes(slug);
}
```

| Construct | Type | Rationale |
|---|---|---|
| `PAYMENT_OVERRIDES` | keyed by `BuiltInCarrierSlug` | Hardcoded behavior; only known carriers |
| `loadCarrierProvider(slug)` | accepts `CarrierSlug`, switch guarded by `isBuiltInCarrier` | Custom carriers return null gracefully |
| `availableCarriers(...)` | returns `CarrierSlug[]` | Dynamic from DB |
| Order fields | `CarrierSlug` | Custom carrier slugs valid |

### Security implications of the type relaxation

Losing compile-time enum exhaustiveness is **developer-pain risk, not exploit
risk**. TypeScript is compile-time only; runtime security comes from:

1. **Zod runtime validation** at every server-action boundary — validates slug
   against `delivery_carriers.slug` set
2. **DB foreign keys** — `orders.carrier_slug` FK to `delivery_carriers.slug`
   prevents writing arbitrary strings
3. **RLS policies** — already in place for orders and config tables
4. **Hardcoded constants** for the few places that compare to specific slugs
   (e.g. `const ACS = "acs" as const;` to prevent typo'd literal comparisons)

A malicious payload `carrier: "<script>"` is blocked by Zod the same way it
would be today. The type system is convenience, not a security boundary.

---

## Carrier capabilities (what each API can do)

Read from the official docs at
[docs/features/API Documentations/Couriers/](docs/features/API%20Documentations/Couriers/).

| Capability | ACS | BoxNow | Geniki | ELTA | Speedex | Other |
|---|---|---|---|---|---|---|
| **Home delivery** | ✓ | ✗ | ✓ | ✓ | ✓ | assumed ✓ |
| **Locker / Smart Point** | ✓ (Smartpoint, KIND=7) | ✓ (the only thing they do) | ✓ (3rd-party `vendor`) | ✓ (APMs) | unknown | assumed ✓ |
| **Branch** | ✓ (central + sub) | ✗ | ✓ | ✓ | ✓ | assumed ✓ |
| **Protocol** | REST-as-RPC | REST + OAuth2 (1h bearer) | SOAP/WSDL | unknown | unknown | n/a |
| **Sizing model** | weight + 3D (cm) | bucket S/M/L | weight only | unknown | unknown | n/a |
| **Inaccessibility flag** | yes (`ΔΠ`) | n/a (locker-only) | not documented | unknown | unknown | n/a |
| **Remote-area surcharge** | yes (`REM` in `Acs_Delivery_Products`) | n/a | unknown | unknown | unknown | n/a |
| **Server-side proximity filter** | no (compute client-side) | yes (`latlng+radius`) | no | unknown | unknown | n/a |
| **List endpoint(s)** | `ACS_Stations` by KIND | `/destinations` (filtered) | `GetShopsList` + `GetLockersList` (no filter) | unknown | unknown | n/a |
| **COD at home** | yes | n/a | yes | unknown | unknown | n/a |
| **COD at locker** | **no** | **yes** (€0–5000 cap) | not documented | unknown | unknown | n/a |
| **COD at branch** | yes | n/a | yes (`ΑΡ` flag) | unknown | unknown | n/a |
| **"Customer picks locker later"** | no | yes (`locationId=2` "any-apm") | no | unknown | unknown | n/a |
| **Finalize step required** | yes (`Issue_Pickup_List`) | no | yes (`ClosePendingJobs`) | unknown | unknown | n/a |
| **Voucher creation** | yes (Create_Voucher) | yes (`/delivery-requests`) | yes (`CreateJob`) | unknown | unknown | n/a |
| **Phone required at voucher** | yes (mandatory for Smartpoint) | yes (for locker SMS) | yes (some services) | unknown | unknown | n/a |
| **Tracking** | yes (Trackingsummary + TrackingDetails) | yes | yes (TrackAndTrace) | unknown | unknown | n/a |
| **Voucher cancellation** | yes | yes | yes (CancelJob) | unknown | unknown | n/a |
| **Returns flow** | partial | ? | rich (CreateReturnRequest) | unknown | unknown | n/a |

---

## Compatibility rules (delivery × payment × carrier)

Source of truth: [`src/config/checkout-compatibility.ts`](src/config/checkout-compatibility.ts).
Used by both the client UI and the server `placeOrder` action.

### Payment × Delivery (universal baseline)

| Payment \ Delivery | home_delivery | store_pickup | locker | branch |
|---|---|---|---|---|
| stripe | ✓ | ✓ | ✓ | ✓ |
| cod | ✓ | ✗ | conditional (overrides) | ✓ |
| cash_on_pickup | ✗ | ✓ | ✗ | ✗ |
| bank_transfer | ✓ | ✓ | ✓ | ✓ |

### Carrier × Delivery

| Carrier \ Delivery | home_delivery | locker | branch |
|---|---|---|---|
| acs | ✓ | ✓ | ✓ |
| box_now | ✗ | ✓ | ✗ |
| elta | ✓ | ✓ | ✓ |
| speedex | ✓ | ✗ (until proven) | ✓ |
| geniki | ✓ | ✓ | ✓ |
| other | ✓ | ✓ | ✓ |
| custom_* | per-admin config | per-admin config | per-admin config |

(`store_pickup` never has a carrier — vendor's own premises.)

### Per-carrier payment overrides

- **`box_now × locker`**: adds `cod` to the baseline (BoxNow has a real
  customer-pays-at-locker flow, lifecycle `pending → paid-by-customer →
  transferred-to-partner`, capped at €5000 per parcel)
- All other carrier×locker combos use the baseline (no COD)

### Auto-reset behavior

When a user changes one of (delivery, payment, carrier) such that a peer
becomes invalid, the system silently switches the orphaned peer to a valid
default. Implemented via `useEffect` in `CheckoutForm.tsx`. Order of
resolution:

1. If carrier is set and doesn't support current delivery → switch delivery
2. If delivery is `store_pickup` → force carrier to ""
3. If delivery isn't `store_pickup` → carrier must support it; else reset
4. Payment must be valid for `(delivery, carrier)`; else reset

### Required fields by combination

| | Shipping address | Recipient phone | Pickup point ID |
|---|---|---|---|
| home_delivery | required | required | — |
| store_pickup | — | required | — |
| locker | — | **mandatory** (ACS Smartpoint requires it; BoxNow needs it for SMS code) | required |
| branch | — | required | required |
| + cod (any) | (per delivery) | required | — |

---

## API capability granularity

For carriers with a provider class, the admin chooses **which capabilities of
that integration the app actively uses**. Some merchants want full automation;
others want only address validation and to keep pricing/voucher creation
manual.

### Storage shape

In `carrier_provider_configs.config` JSON, a `capabilities` block:

```jsonc
{
  "base_url": "...",
  "billing_code": "...",
  "origin_station": "...",
  "capabilities": {
    "address_validation": true,
    "surface_inaccessibility": true,
    "fetch_price_quote": false,
    "apply_remote_surcharge": false,
    "list_smartpoints": true,
    "list_branches": true,
    "create_voucher": true,
    "fetch_tracking": true,
    "batch_finalize": true,
    "store_api_quote_for_audit": false
  }
}
```

### The capability set (per-carrier supported subset)

Not every carrier supports every capability. Each provider class declares its
supported set; admin can toggle within that set.

| Capability | ACS | BoxNow | Geniki | Description |
|---|---|---|---|---|
| `address_validation` | ✓ | n/a | n/a | Call zip→station lookup, derive serviceability |
| `surface_inaccessibility` | ✓ | n/a | n/a | Show "remote area" banner to customer in checkout |
| `fetch_price_quote` | ✓ | ✗ (no preview endpoint) | depends | Call carrier's pricing API |
| `apply_remote_surcharge` | ✓ | n/a | n/a | Include REM-style surcharge in quote |
| `list_smartpoints` | ✓ | ✓ | ✓ | Populate locker picker |
| `list_branches` | ✓ | ✗ | ✓ | Populate branch picker |
| `defer_locker_selection` | ✗ | ✓ | ✗ | BoxNow's "any-apm" feature |
| `create_voucher` | ✓ | ✓ | ✓ | Generate shipping voucher via API |
| `fetch_tracking` | ✓ | ✓ | ✓ | Pull status updates from carrier |
| `batch_finalize` | ✓ (Issue_Pickup_List) | ✗ | ✓ (ClosePendingJobs) | Daily handoff close |
| `cancel_voucher` | ✓ | ✓ | ✓ | Cancel via API |
| `store_api_quote_for_audit` | depends on fetch_price_quote | n/a | depends | Persist `api_quote` alongside `charged` on order |

### Provider self-declares its supported set

```ts
interface CarrierProvider {
  readonly carrier: BuiltInCarrierSlug;
  supportedCapabilities(): Set<Capability>;
  // ... existing methods
}
```

Admin form filters checkboxes to what the provider class supports. Custom
carriers have no provider class → no capability checkboxes.

### Dependency graph

| Capability | Requires (auto-disable on parent off) |
|---|---|
| `surface_inaccessibility` | `address_validation` |
| `apply_remote_surcharge` | `fetch_price_quote` |
| `store_api_quote_for_audit` | `fetch_price_quote` |
| `defer_locker_selection` | provider exposes "any-apm" (BoxNow only) |

UI auto-disables and hides dependent capabilities when parent is off.

### Admin UI: presets to keep UX manageable

Three sensible presets, plus "Custom" for raw toggles:

1. **"Full integration"** — every supported capability ON
2. **"Validation + operations"** — pre-checkout validation + voucher/tracking; pricing OFF
3. **"Manual"** — credentials stored, nothing called automatically (`is_active=true`
   gates visibility independently)
4. **"Custom"** — per-capability checkboxes

### Runtime gates: where each capability is consulted

| Call site | Capability gate |
|---|---|
| `fetchCarrierQuote()` address resolution branch | `address_validation` |
| `fetchCarrierQuote()` price call branch | `fetch_price_quote` |
| Inaccessibility banner in checkout | `surface_inaccessibility` (+ `address_validation`) |
| `<LocationPicker>` locker tab for this carrier | `list_smartpoints` OR `defer_locker_selection` |
| `<LocationPicker>` branch tab for this carrier | `list_branches` |
| `createVoucher` server action | `create_voucher` |
| `fees_breakdown[].api_quote` population | `store_api_quote_for_audit` |
| Tracking link in customer order page | `fetch_tracking` |
| Admin "close batch" action visibility | `batch_finalize` |
| Voucher cancel button in admin | `cancel_voucher` |
| `availableCarriers(delivery)` includes this carrier for locker delivery | `list_smartpoints` OR `defer_locker_selection` |

### Interaction with `pricing_source` on fee categories

Existing `fee_categories.pricing_source` (`'api'` vs `'custom'`) combines with
the carrier capability:

| `fetch_price_quote` (carrier) | `pricing_source` (category) | Outcome |
|---|---|---|
| true | `api` | API quote = charged amount. Audit identical. |
| true | `custom` | Custom rule = charged. API quote populates `api_quote` if `store_api_quote_for_audit` ON. |
| false | `api` | No quote available → falls back to custom rules. `api_quote=null`. **Misconfig — surface warning to admin.** |
| false | `custom` | Custom rule = charged. `api_quote=null`. **Merchant A's "I don't even want to know" scenario.** |

---

## Status vocabulary

### Design: shared codes, per-carrier timelines, separate display labels

Four-layer architecture:

```
StatusCode                       — one shared enum, rich vocabulary (~18 codes)
   ↓
STATUS_LABELS[code]              — per audience (admin Greek, customer Greek, future English)
   ↓
PHASE_OF[code] → Phase           — derived 5-6 bucket aggregate, used for filters/reports
   ↓
TIMELINE_BY_CARRIER[carrier]     — ordered list of codes that apply to this carrier
   ↓
API_MAPPING_BY_CARRIER[carrier]  — { ourCode ↔ theirNative } — only for integrated carriers
```

Each layer has one responsibility, no overlap.

**Codes** are the truth stored on `orders.status`. Same code works across all
carriers — `delivered` means delivered whether shipped by ACS or BoxNow.

**Labels** are presentation. Admin sees one label, customer sees another (often
warmer wording). No carrier-specific text — one translation table.

**Phase** is derived 5-6 buckets for aggregate queries ("how many in transit
this week?"). Computed from code, not stored.

**Timeline** is per-carrier UI sequencing — which codes apply to this carrier,
in what order, used to drive the customer-facing timeline visualization and
the admin "next status" suggester.

**API mapping** is the bidirectional bridge between our shared code and the
carrier's native vocabulary. Only relevant for integrated carriers.

### The shared vocabulary (~18 codes)

```ts
export type StatusCode =
  // Pre-shipment (merchant-controlled, no carrier API)
  | "draft"
  | "pending"
  | "confirmed"
  | "preparing"

  // Carrier-driven
  | "label_created"
  | "awaiting_carrier"
  | "in_transit"
  | "out_for_delivery"
  | "arrived_at_pickup"
  | "on_hold"
  | "delivered"                      // door delivery
  | "collected"                      // locker / branch pickup

  // Exception sub-states
  | "delivery_attempted_absent"
  | "delivery_attempted_refused"
  | "delivery_attempted_wrong_address"
  | "delivery_attempted_damaged"

  // Terminal exceptions
  | "returning"
  | "returned"
  | "cancelled"
  | "lost";
```

Each code has an admin label and a customer label, both in Greek:

```ts
const STATUS_LABELS: Record<StatusCode, { admin: string; customer: string }> = {
  delivered: {
    admin: "Παραδόθηκε στην πόρτα",
    customer: "Η παραγγελία σας παραδόθηκε",
  },
  collected: {
    admin: "Παραλήφθηκε από locker/κατάστημα",
    customer: "Παραλήφθηκε από το σημείο παραλαβής",
  },
  delivery_attempted_absent: {
    admin: "Απουσία παραλήπτη",
    customer: "Δεν βρεθήκατε για την παράδοση",
  },
  // ...
};
```

### Phase axis (derived)

```ts
const PHASE_OF: Record<StatusCode, Phase> = {
  draft:     "draft",
  pending:   "pre_shipment",
  confirmed: "pre_shipment",
  preparing: "pre_shipment",

  label_created:     "pre_shipment",
  awaiting_carrier:  "pre_shipment",

  in_transit:        "in_transit",
  out_for_delivery:  "in_transit",

  arrived_at_pickup: "at_destination",
  on_hold:           "at_destination",

  delivered: "completed",
  collected: "completed",

  delivery_attempted_absent:        "exception",
  delivery_attempted_refused:       "exception",
  delivery_attempted_wrong_address: "exception",
  delivery_attempted_damaged:       "exception",
  returning:                        "exception",
  returned:                         "exception",
  cancelled:                        "exception",
  lost:                             "exception",
};
```

### Per-carrier comparison (semantic equivalence)

Where each code originates per carrier:

| Our code | ACS | BoxNow | Geniki |
|---|---|---|---|
| `label_created` | (implicit, set at Create_Voucher) | `new` | `C_NW`, `C_KK` |
| `awaiting_carrier` | (pre-Issue_Pickup_List) | `wait-for-load` | (implicit) |
| `in_transit` | shipment_status=5 + ΔΔ1/ΕΑ1 + hub checkpoints | `intransit` | `C_H1`, `C_H2`, `C_K8`, `C_L1` |
| `out_for_delivery` | checkpoint "ΚΑΤΑΝΟΜΗ ΣΕ COURIER" | — (no equivalent) | `C_A3` |
| `arrived_at_pickup` | checkpoint "ΑΦΙΞΗ ΣΕ ΚΑΤΑΣΤΗΜΑ" | `in-final-destination` | `C_A1` |
| `on_hold` | shipment_status=5 + ΠΑ2 | — | `C_D2` |
| `delivered` | shipment_status=4 + delivery_flag=1, no REC | n/a (locker-only) | `C_W2` |
| `collected` | delivery_flag=1 + REC voucher service | `delivered` (always means collected) | `C_W3` |
| `delivery_attempted_absent` | shipment_status=3 + ΑΣ1 | — | `C_EA_AS` |
| `delivery_attempted_refused` | shipment_status=1 + ΑΠ1/ΑΠ2/ΑΠ3 | — | `C_EA_AP` |
| `delivery_attempted_wrong_address` | shipment_status=2 + ΛΣ1/ΛΣ3 | — | `C_EA_LD`, `C_EA_AG` |
| `delivery_attempted_damaged` | — | — | `C_EA_AK` |
| `returning` | returned_flag in progress | `expired-return` | `C_E1` |
| `returned` | returned_flag=1 | `returned` | (final after C_E1) |
| `cancelled` | via CancelJob | `cancelled` | `C_P4` |
| `lost` | — | `lost` / `missing` | — |

### Per-carrier timelines

Each carrier has an ordered list of codes that constitute its normal flow,
plus optional exception branches. UI uses this for:

- Admin dropdown filtered to relevant codes only
- Customer-facing timeline visualization
- "Suggested next status" UX hint

```ts
const ACS_TIMELINE: CarrierTimeline = {
  carrier: "acs",
  stages: [
    { code: "preparing",        isMain: true },
    { code: "label_created",    isMain: true },
    { code: "awaiting_carrier", isMain: false },  // ACS doesn't always surface this
    { code: "in_transit",       isMain: true },
    { code: "out_for_delivery", isMain: true },
    { code: "delivered",        isMain: true, terminal: true },
    { code: "arrived_at_pickup",isMain: true },   // for branch / smartpoint orders
    { code: "collected",        isMain: true, terminal: true },
    // Exception branches
    { code: "delivery_attempted_absent",         isMain: false, exception: true },
    { code: "delivery_attempted_refused",        isMain: false, exception: true },
    { code: "delivery_attempted_wrong_address",  isMain: false, exception: true },
    { code: "on_hold",                           isMain: false, exception: true },
    { code: "returning",                         isMain: false, exception: true },
    { code: "returned",                          isMain: false, exception: true, terminal: true },
    { code: "cancelled",                         isMain: false, exception: true, terminal: true },
  ],
};

const BOXNOW_TIMELINE: CarrierTimeline = {
  carrier: "box_now",
  stages: [
    { code: "preparing",         isMain: true },
    { code: "label_created",     isMain: true },
    { code: "awaiting_carrier",  isMain: true },   // BoxNow exposes this
    { code: "in_transit",        isMain: true },
    // No out_for_delivery — BoxNow goes straight to arrived_at_pickup
    { code: "arrived_at_pickup", isMain: true },
    { code: "collected",         isMain: true, terminal: true },
    { code: "returning",         isMain: false, exception: true },
    { code: "returned",          isMain: false, exception: true, terminal: true },
    { code: "cancelled",         isMain: false, exception: true, terminal: true },
    { code: "lost",              isMain: false, exception: true, terminal: true },
  ],
};

const GENIKI_TIMELINE: CarrierTimeline = {
  carrier: "geniki",
  stages: [
    { code: "preparing",          isMain: true },
    { code: "label_created",      isMain: true },
    { code: "in_transit",         isMain: true },
    { code: "out_for_delivery",   isMain: true },
    { code: "delivered",          isMain: true, terminal: true },
    { code: "arrived_at_pickup",  isMain: true },   // branch orders
    { code: "collected",          isMain: true, terminal: true },
    { code: "delivery_attempted_absent",         isMain: false, exception: true },
    { code: "delivery_attempted_refused",        isMain: false, exception: true },
    { code: "delivery_attempted_wrong_address",  isMain: false, exception: true },
    { code: "delivery_attempted_damaged",        isMain: false, exception: true },
    { code: "on_hold",                           isMain: false, exception: true },
    { code: "returning",                         isMain: false, exception: true },
    { code: "returned",                          isMain: false, exception: true, terminal: true },
    { code: "cancelled",                         isMain: false, exception: true, terminal: true },
  ],
};
```

Built-in carriers have hardcoded timelines. Custom carriers either reuse a
built-in timeline preset OR define their own subset of the shared vocabulary
via the admin UI.

### Per-carrier API mappings

The bidirectional translation between our `StatusCode` and the carrier's
native code. Only present for carriers with `fetch_tracking` capability.

```ts
function mapBoxNowState(state: string): StatusCode {
  switch (state) {
    case "new":                  return "label_created";
    case "wait-for-load":        return "awaiting_carrier";
    case "intransit":            return "in_transit";
    case "in-final-destination": return "arrived_at_pickup";
    case "delivered":            return "collected";
    case "expired-return":       return "returning";
    case "returned":             return "returned";
    case "cancelled":            return "cancelled";
    case "lost":
    case "missing":              return "lost";
    default:                     return /* keep current */;
  }
}

function mapGenikiCheckpoint(code: string): StatusCode {
  switch (code) {
    case "C_NW":                 return "label_created";
    case "C_KK":                 return "label_created";
    case "C_H1": case "C_H2":
    case "C_L1": case "C_K8":    return "in_transit";
    case "C_A3":                 return "out_for_delivery";
    case "C_A1":                 return "arrived_at_pickup";
    case "C_D2":                 return "on_hold";
    case "C_W2":                 return "delivered";
    case "C_W3":                 return "collected";
    case "C_EA_AS":              return "delivery_attempted_absent";
    case "C_EA_AP":              return "delivery_attempted_refused";
    case "C_EA_LD":
    case "C_EA_AG":              return "delivery_attempted_wrong_address";
    case "C_EA_AK":              return "delivery_attempted_damaged";
    case "C_E1":                 return "returning";
    case "C_P4":                 return "cancelled";
    default:                     return /* keep current */;
  }
}

function mapAcsShipmentStatus(
  shipment_status: number,
  non_delivery_reason_code: string | null,
  delivery_flag: 0 | 1,
  returned_flag: 0 | 1,
  has_rec_service: boolean
): StatusCode {
  if (returned_flag === 1) return "returned";
  if (delivery_flag === 1) return has_rec_service ? "collected" : "delivered";
  if (shipment_status === 4) return "delivered";
  if (shipment_status === 3 || non_delivery_reason_code === "ΑΣ1") return "delivery_attempted_absent";
  if (shipment_status === 1) return "delivery_attempted_refused";
  if (shipment_status === 2) return "delivery_attempted_wrong_address";
  if (shipment_status === 5 && ["ΠΑ2","ΠΑ4"].includes(non_delivery_reason_code ?? "")) return "on_hold";
  if (shipment_status === 5) return "in_transit";
  return /* keep current */;
}
```

Mappings are pure functions kept alongside their provider class.

### Carrier-raw context preserved alongside

Even with the shared vocabulary, we store the carrier's raw status for
admin-side detail and debugging:

```
orders.status                    StatusCode    (unified, customer-facing)
orders.carrier_raw_status        text          ('C_EA_AP', 'in-final-destination', '4_ΑΣ1', etc.)
orders.carrier_status_label      text          (human-readable from carrier, in carrier's language)
orders.carrier_status_updated_at timestamptz
orders.status_set_by             text          ('api' or 'merchant') — audit
```

Admin order page shows "Παραδόθηκε" plus a "Carrier detail: 'Shipment Delivered'
recorded by Geniki on Mar 5, 14:23" sub-line. Customer sees only the friendly
Greek label.

### Custom carrier timelines

Two paths for a merchant creating "Παράδοση δικιά μας":

1. **Preset reuse**: pick an existing timeline ("ACS-style with home delivery")
   from a dropdown. The timeline points at the shared codes, just ordered.
2. **Custom timeline**: assemble from the shared vocabulary, ordering them in
   the admin form. Store as JSON on the `delivery_carriers` row.

For most custom carriers, preset reuse covers 90% of cases. Custom is for
exotic flows (e.g., a merchant with their own warehouse-to-customer service
that has fewer stages than any built-in).

---

## Tracking model

Three independently configurable layers:

### Layer 1: where tracking data comes from

| Source | Mechanism | When it applies |
|---|---|---|
| **API-fetched** | Provider's `fetchTracking(voucherNo)` is called; updates `status` + `carrier_raw_status` | When `fetch_tracking` capability is ON |
| **Manual** | Merchant updates status via the admin order page | Always works; the only source for non-integrated/custom carriers |

Both can coexist on integrated carriers. API drives auto-updates; merchant can
override.

### Layer 2: where customer sees tracking

- **Inline status timeline** on customer's order page — driven by
  `orders.status` (and `carrier_raw_status` for detail)
- **"Track on {carrier}" button** — opens carrier's public tracking site in a
  new tab (or merchant's external tracker for custom carriers)

The button is independent of API integration:

- ACS integrated → inline timeline + button to acs.gr
- Speedex unintegrated → no inline timeline, but button to speedex.gr (using
  the template + manually-entered voucher)
- Custom "Van" carrier → either custom tracking URL or just the timeline

### Layer 3: voucher / tracking number capture

| Path | How tracking_number is set |
|---|---|
| **API-integrated** (`create_voucher` ON) | Returned by `createVoucher`, written to `orders.tracking_number` automatically |
| **Non-integrated** | Merchant types into the admin order page after creating voucher in carrier's portal |
| **Custom carrier** | Merchant types in (or leaves blank if no external tracking) |

### Schema additions

Per-carrier (on `delivery_carriers` row):

```
tracking_url_template  text     -- e.g. "https://www.acscourier.net/track?p={voucher}"
                                -- null = no external button shown
```

Per-order:

```
tracking_number        text     -- set by createVoucher or merchant-entered
tracking_url_override  text     -- one-off URL if merchant has a unique tracker for this order
```

### Render logic on customer order page

```pseudo
if order.tracking_number is present:
  show inline status timeline (always)

  if order.tracking_url_override is set:
    show "Track shipment" button → opens override URL
  else if carrier.tracking_url_template is set:
    show "Track on {carrier.display_name}" button
    → opens template.replace('{voucher}', order.tracking_number)
```

### Seed tracking URL templates for built-in carriers

| Carrier | Default `tracking_url_template` |
|---|---|
| ACS | `https://www.acscourier.net/en/tracking?p_no={voucher}` |
| BoxNow | `https://boxnow.gr/track-parcel/{voucher}` (TBD — confirm exact URL) |
| Geniki | `https://www.taxydromiki.com/track/{voucher}` |
| ELTA | seed standard public URL (TBD) |
| Speedex | seed standard public URL (TBD) |

---

## Caching strategy by data type

| Data type | Strategy | Cache key | TTL | Refresh trigger |
|---|---|---|---|---|
| Location directories (stations/lockers/branches) | Pre-fetch all, serve from local | `(carrier, country, kind)` | 30–90 days | Scheduled cron, weekly |
| Postcode resolution (zip → station + inaccessibility) | Lazy cache on first hit | `(carrier, country, zipcode)` | 60 days | Lazy on stale read |
| Price quotes | Never cache | n/a | n/a | Always fresh per checkout |

Rationale:

- **Directories**: small (KBs per carrier), slow-changing, globally relevant.
  Pre-fetching enables instant in-checkout pickers with zero on-path latency.
- **Postcode resolution**: per-zip; can't pre-fetch 12k Greek zipcodes
  efficiently; zipcode-keyed means cross-customer benefit.
- **Quotes**: high cardinality (zip × weight × dim × COD × services); legally
  sensitive; the quote call is the primary reason we hit the API anyway.

### Per-carrier vs unified cache tables

Today: `acs_postcode_cache`, `acs_station_cache` — per-carrier.

When 3rd carrier integrates: refactor to `couriers_postcode_cache`
(keyed by `carrier+zipcode`) and `couriers_location_cache` (keyed by
`carrier+country+location_id+type+kind`). Small migration, aligns with
admin-gated rollout.

---

## Provider abstraction

`CarrierProvider` interface in [`src/lib/courier/provider.ts`](src/lib/courier/provider.ts).

### Current methods

- `testConnection()`
- `findAreaByZip(zip, country)`
- `priceCalculate(ctx)`
- `listStations(country, kind)`
- `createVoucher(ctx)` — stub
- `trackingSummary(voucherNo)` — stub

### To add

- `supportedCapabilities(): Set<Capability>` — what this provider can do at all
- `finalizeBatch()` — daily handoff close (`Issue_Pickup_List` / `ClosePendingJobs`); no-op for BoxNow
- `authenticate()` — token lifecycle; no-op for ACS, mandatory for BoxNow / Geniki
- `fetchTracking(voucherNo): Promise<TrackingResult>` — promotes from stub
- `cancelVoucher(voucherNo): Promise<CancelResult>`
- `mapNativeStatus(raw): StatusCode` — per-carrier status translation

---

## Admin configuration model

Two tables, two purposes:

1. **`delivery_carriers`** — every carrier the system knows about (built-in +
   custom). Controls visibility at checkout, supported delivery methods,
   tracking URL template.

2. **`carrier_provider_configs`** — credentials + capability config for
   API-integrated carriers (subset of `delivery_carriers` where a provider
   class exists in code).

### Admin UI: two-pane Couriers page

**Pane 1 — Carriers list**: every `delivery_carriers` row.
- Toggle visibility (`is_active`)
- Edit display name (custom only)
- Edit supported delivery methods (capped by provider's structural ceiling for built-ins)
- Create new custom carrier
- Delete custom carrier
- Edit tracking URL template
- Edit timeline (custom only, via preset or manual)

**Pane 2 — API configuration**: for each carrier with a provider class:
- Credentials (encrypted, AES-256-GCM via `CARRIER_SECRETS_KEY`)
- Capability toggles (filtered by `supportedCapabilities()`)
- Preset selector ("Full" / "Validation + ops" / "Manual" / "Custom")
- Test connection button
- Activation status

---

## Current implementation state

### Implemented ✓

| Surface | What exists |
|---|---|
| ACS provider | `findAreaByZip`, `priceCalculate`, `listStations(KIND=1)`, `testConnection` |
| Cache tables | `acs_postcode_cache`, `acs_station_cache` (both 30-day TTL) |
| Carrier loader | `loadCarrierProvider(carrier)` with active-row gating + decryption |
| Quote orchestration | `fetchCarrierQuote(ctx)` does cache + provider call |
| Order schema | `orders.carrier`, `orders.delivery_method`, `orders.payment_method`, `orders.cod_amount`, `orders.fees_total`, `orders.fees_breakdown` |
| Admin couriers tab | `/admin/settings/couriers` list + add/edit/test/activate/delete (ACS-only enforced in form) |
| Carrier secrets encryption | AES-256-GCM with `CARRIER_SECRETS_KEY` |
| Compatibility matrix | `src/config/checkout-compatibility.ts` — `delivery × payment` with carrier-specific overrides (BoxNow COD-at-locker) |
| Checkout UI guards | Disables invalid options, auto-resets on conflict |
| Server validation gate | `placeOrder.ts` calls `isCompatible(...)` before any writes |
| Inaccessibility flag cached | `is_inaccessible` populated from `Inaccessible_Area_Kind = "ΔΠ"` |
| Fee preview at checkout | `previewFees` server action + `useEffect` in `CheckoutForm` that re-renders summary on context change (Δone in this session) |
| Fee resolver | `resolveFees` with API quote + custom rule branches, audit population |

### Stubbed / Missing ✗

| Surface | Gap |
|---|---|
| ACS `createVoucher` | Phase 4 stub — throws |
| ACS Smartpoint listing | Need `listStations(KIND=7)` |
| ACS `Issue_Pickup_List` | Not built |
| ACS `trackingSummary` | Stub |
| BoxNow provider | Does not exist |
| Geniki provider | Does not exist |
| ELTA / Speedex providers | Do not exist |
| `delivery_carriers` table | Carrier list is still an enum, not data |
| Custom carrier creation | Not built |
| Capability config in DB | No `capabilities` block in `carrier_provider_configs.config` |
| `supportedCapabilities()` on provider | Not in interface |
| Active-carrier filter at checkout | Carrier list reads enum, not active configs |
| `listActiveCarriers()` helper | Does not exist |
| Inaccessibility UX in checkout | Cache flag exists but not surfaced |
| Remote-area surcharge (`REM`) in quote | Not sent even when zip is remote |
| Cart-eligibility checks | Not built |
| Status vocabulary expansion | Existing 9-state enum, not the 18-state shared vocabulary |
| Status timeline data | No `TIMELINE_BY_CARRIER` registry |
| Status API mappings | No mapping functions |
| Tracking number field | Not on orders table |
| Tracking URL template | Not on carriers row |
| `<LocationPicker>` component | Not built |
| Order pickup columns | Not migrated (`pickup_carrier`, `pickup_station_id`, etc.) |
| Directory refresh cron | Not built |

---

## Open questions

### Resolved by the carrier model and capability granularity sections

- ~~Q1. Non-API carriers in customer-facing picker?~~ **Yes, by design.** Custom
  carriers + non-API-configured built-ins are valid options. Fee rules cover
  them.
- ~~Q2. What does the customer see when no active carrier supports a delivery
  method?~~ **Hide the delivery method entirely.**
- ~~Q3. Does `is_active=false` mean "invisible" or "operational-but-paused"?~~
  **Invisible.** `is_active` on the carrier row is THE visibility gate.

### Still open

**Q4. Per-cart eligibility — where does the rule live?**

E.g., cart weight 8kg, ACS Smartpoint cap is 6kg. Options:
- (a) Hard-code per-carrier limits in compatibility config
- (b) Each provider exposes `canFulfilCart(cart): boolean`
- (c) Admin-configurable in carrier's `config` JSON

Recommendation: (b) for structural rules (provider knows its constraints), (c)
as override for merchant-specific exceptions.

**Q5. "Any-apm" deferred locker selection (BoxNow)?**

Expose as a separate row in the locker picker ("Επιλέξτε αργότερα")? Recommend
yes.

**Q6. Geniki's vendor-tagged lockers — overlap with BoxNow?**

When showing locker picker:
- (a) Show each locker once per carrier offering it
- (b) Dedupe by physical location, present as one locker with multiple carrier options

Recommend (a) — simpler, matches customer's "carrier first" mental model.

**Q7. Postcode resolution for non-ACS carriers?**

ACS exposes serviceability + inaccessibility. Geniki / ELTA / Speedex don't.
For home delivery via non-ACS:
- (a) Don't pre-validate; let voucher creation fail at handoff
- (b) Per-carrier serviceability tables from admin CSV
- (c) Defer non-ACS home delivery until carrier integrates

Recommend (a) as default; (b)/(c) only if real friction shows up.

**Q8. Locker COD for non-BoxNow carriers (Geniki, ELTA, Other)?**

Today: BoxNow only. Add `cod` to `PAYMENT_OVERRIDES` per-carrier if their docs
confirm support. Conservative default.

**Q9. Multi-carrier voucher / cart split?**

If cart items have conflicting carrier constraints (one fits BoxNow bucket,
another doesn't), do we split into multiple shipments?

- (a) One order = one carrier = one voucher (current model)
- (b) Allow shipment splits

Recommend (a) for now. Significantly more complex to allow splits.

**Q10. Where does merchant batch-finalization happen?**

ACS and Geniki require closing a batch before pickup.
- (a) Dedicated "Daily handoff" admin page with one button
- (b) Inline action on orders list
- (c) Automated cron at configurable time

Recommend (a) for visibility.

**Q11. Granularity of `delivery_attempted` sub-codes?**

Settled: 4 sub-codes (absent, refused, wrong_address, damaged). Each maps to
operationally different next steps. Carriers without that granularity simply
never fire those codes.

**Q12. Customer-facing detail vs phase?**

Show granular ("Απόρριψη παραλαβής") or coarse ("Καθυστέρηση στην παράδοση")?
Recommend granular for transparency, with a help tooltip explaining what each
means.

---

## Implementation plan

Three concerns woven through this plan:

- **A — API capability granularity** (the per-capability config + provider gates)
- **B — Non-integrated workflow** (custom carriers, manual operations, custom rules)
- **C — API workflow integration** (ACS as the proving ground, BoxNow + Geniki later)

Each phase advances one or more of these. Ordering reflects dependency, not
strict priority.

### Phase 0 — Carrier model as data (foundation)

**Concerns advanced**: A, B, C

The single change that unlocks everything else. Until the carriers table
exists, everything below is gated.

**Database**:

- New migration `couriers_table.sql`:
  - Create `delivery_carriers` table (schema in [Carrier model](#carrier-model-three-buckets-and-the-visibility-axis))
  - Seed 6 built-in rows (acs, elta, box_now, speedex, geniki, other) with default `supported_delivery_methods`, `is_active=false`, `is_custom=false`
  - RLS: admin-only writes; public reads for `is_active=true` (checkout needs to list them)
- Migration `orders_carrier_slug_fk.sql`:
  - Add `orders.carrier_slug text references delivery_carriers(slug)`
  - Backfill from `orders.carrier` enum
  - Drop old `orders.carrier` column after backfill verification
- Migration `carrier_provider_configs_fk.sql`:
  - Replace `carrier text CHECK (...)` with FK to `delivery_carriers(slug)`

**Code**:

- New type definitions: `BuiltInCarrierSlug`, `CarrierSlug`, `isBuiltInCarrier`
- Update `Carrier` type in `src/types/order-history.ts` to `CarrierSlug`
- Find/replace `CarrierValue` → `CarrierSlug` across consumers
- Add hardcoded constants for built-in slugs: `const ACS_SLUG = "acs" as const;` etc.
- Update Zod schemas at server-action boundaries to validate slug against
  active carrier list (runtime check, not type)
- Refactor `availableCarriers(delivery)` to take `CarrierSlug[]` arg
  (active carriers from DB)
- Refactor `availableDeliveryMethods(carrier)` similarly

**Test surface**: type-check the whole codebase; manual smoke through checkout
to ensure old `acs` enum string still works after backfill.

**Exit criterion**: existing functionality unchanged; DB now sourcetruth for
carrier list; can theoretically insert custom carrier and have it appear
nowhere (since no admin UI yet).

---

### Phase 1 — Active carrier visibility at checkout

**Concerns advanced**: A, B, C

Customer-facing UI now respects admin choices on which carriers to show.

**Code**:

- New file `src/lib/courier/listActiveCarriers.ts`:
  - Server helper returning `delivery_carriers` rows where `is_active=true`
  - Wrapped in `React.cache` for per-request dedup
- Update [checkout page](src/app/checkout/page.tsx) to fetch active carriers
  server-side, pass as prop
- Update `CheckoutForm.tsx`:
  - Accept `activeCarriers: CarrierRow[]` prop
  - Use it in carrier `<select>` (replace static `CARRIER_OPTIONS`)
  - If no active carrier supports a delivery method, hide the radio entirely
  - Auto-reset effect also reads from `activeCarriers`
- Update `placeOrder.ts` to re-validate that the submitted carrier is in the
  active set (defense in depth)
- Update `previewFees` to do the same (cheap check, prevents calling fee
  resolver with invalid carriers)

**Test surface**: with no carriers active → checkout shows no carrier
options. Activate ACS → only ACS appears. Toggle BoxNow visibility → only the
locker delivery method shows BoxNow.

---

### Phase 2 — Status vocabulary expansion

**Concerns advanced**: A, B, C

Foundation for everything related to tracking, timelines, and customer/admin
status display.

**Database**:

- Migration `expand_fulfillment_status.sql`:
  - Add new values to the `fulfillment_status` enum: `label_created`,
    `awaiting_carrier`, `arrived_at_pickup`, `on_hold`, `collected`,
    `delivery_attempted_absent`, `delivery_attempted_refused`,
    `delivery_attempted_wrong_address`, `delivery_attempted_damaged`,
    `returning`, `returned`, `lost`
  - Keep existing values for back-compat
  - Postgres `ALTER TYPE ... ADD VALUE` is straightforward (no downtime)
- Migration `orders_status_audit_fields.sql`:
  - `ALTER TABLE orders ADD COLUMN carrier_raw_status text`
  - `ALTER TABLE orders ADD COLUMN carrier_status_label text`
  - `ALTER TABLE orders ADD COLUMN carrier_status_updated_at timestamptz`
  - `ALTER TABLE orders ADD COLUMN status_set_by text CHECK (status_set_by IN ('api','merchant'))`

**Code**:

- New file `src/config/status-vocabulary.ts`:
  - `StatusCode` type (18 codes)
  - `STATUS_LABELS` per-audience labels (admin + customer Greek)
  - `PHASE_OF` mapping
  - `Phase` type (5-6 buckets)
- New file `src/config/status-timelines.ts`:
  - `TIMELINE_BY_CARRIER` for built-ins (ACS, BoxNow, Geniki)
  - Default timeline for custom carriers (preset)
  - Helper `getTimelineForOrder(order): CarrierTimeline`
- Update admin order page status dropdown to filter by timeline (only show
  codes valid for this carrier)
- Update customer order page to render timeline visualization:
  - Show all `isMain` codes in order
  - Highlight current status
  - Show exception codes when applicable
- Update `FULFILLMENT_STATUSES` const to be derived from `StatusCode` union
- Backfill existing orders: map old enum values to new shared vocabulary

**Test surface**: existing orders display correctly under the new label
system; admin can transition through statuses; customer order page shows
timeline.

---

### Phase 3 — Tracking model

**Concerns advanced**: A, B, C

Customer-visible tracking, integrated and manual.

**Database**:

- Migration `carriers_tracking_url.sql`:
  - `ALTER TABLE delivery_carriers ADD COLUMN tracking_url_template text`
  - Seed defaults for built-in carriers
- Migration `orders_tracking_fields.sql`:
  - `ALTER TABLE orders ADD COLUMN tracking_number text`
  - `ALTER TABLE orders ADD COLUMN tracking_url_override text`

**Code**:

- Admin order page:
  - Add `tracking_number` input (manual entry for non-integrated carriers)
  - Add `tracking_url_override` input (rare-case override)
- Customer order page:
  - Render "Track on {carrier}" button per the [render logic](#render-logic-on-customer-order-page)
  - Button visible only when `tracking_number` is set
- Helper `src/lib/courier/buildTrackingUrl.ts`:
  - `buildTrackingUrl(order, carrier): string | null`
  - Returns `tracking_url_override` if set, else template+voucher, else null

**Test surface**: enter a tracking number on a manual ACS order → "Track on
ACS" button appears on customer page → opens correct URL.

---

### Phase 4 — API capability granularity config

**Concerns advanced**: A

Per-capability toggles in admin UI, runtime gates everywhere.

**Code**:

- Define `Capability` type in `src/types/carrier-provider.ts`:
  ```ts
  export type Capability =
    | "address_validation"
    | "surface_inaccessibility"
    | "fetch_price_quote"
    | "apply_remote_surcharge"
    | "list_smartpoints"
    | "list_branches"
    | "defer_locker_selection"
    | "create_voucher"
    | "fetch_tracking"
    | "batch_finalize"
    | "cancel_voucher"
    | "store_api_quote_for_audit";
  ```
- Add `capabilities` field to `CarrierProviderConfig` (typed as
  `Partial<Record<Capability, boolean>>`)
- Add `supportedCapabilities()` to `CarrierProvider` interface
- Implement `supportedCapabilities()` in `AcsProvider` returning the ACS set
- New helper `src/lib/courier/getCapabilities.ts`:
  ```ts
  export async function getCapabilities(carrier: CarrierSlug): Promise<Set<Capability>>
  ```
  Reads config + intersects with provider's supported set + applies preset
  defaults if config doesn't specify
- Update consumers to consult capabilities:
  - `fetchCarrierQuote()` — gate on `address_validation` for findAreaByZip
    branch, `fetch_price_quote` for priceCalculate branch
  - `resolveFees` — gate audit population on `store_api_quote_for_audit`
- Admin form (`CarrierProviderForm.tsx`):
  - Add preset selector ("Full" / "Validation+ops" / "Manual" / "Custom")
  - Add capability checkboxes (auto-set by preset, editable in Custom mode)
  - Filter checkboxes by `supportedCapabilities()`
  - Auto-disable dependent capabilities when parent off
  - Warning banner for misconfig (e.g., category is API but carrier's
    `fetch_price_quote` is off)

**Test surface**: Merchant A scenario — enable address_validation + voucher
creation + tracking, disable fetch_price_quote → checkout uses custom rules
for shipping, ACS still validates address.

---

### Phase 5 — ACS UX polish (inaccessibility + remote surcharge)

**Concerns advanced**: C

Smallest unit of customer-facing value. Pure UI on top of existing data.

**Code**:

- Update `CheckoutForm.tsx`:
  - When `is_inaccessible=true` from postcode cache AND
    `surface_inaccessibility` capability ON → show Greek banner:
    "Η περιοχή σας είναι απομακρυσμένη — μπορεί να ισχύει επιπλέον χρέωση"
- Update `priceCalculate` call site in ACS provider:
  - When `is_inaccessible=true` AND `apply_remote_surcharge` capability ON:
    - Add `"REM"` to `Acs_Delivery_Products` (alongside any existing COD)
  - The quote returned will include the surcharge naturally
- Customer sees updated total via the existing fee preview infrastructure

**Test surface**: Use a known remote zipcode → banner appears, shipping total
includes surcharge.

---

### Phase 6 — ACS Smartpoint listing

**Concerns advanced**: C

Add KIND=7 fetching for locker support.

**Code**:

- Update `AcsProvider.listStations(country, kind)` — already supports kind
  param; just need to call with `kind=7`
- New server action `src/actions/courier-settings/listAcsSmartpoints.ts`:
  similar to existing `listAcsStations`, just KIND=7
- Add to admin Couriers page: button to fetch and cache Smartpoint list
- Schedule weekly auto-refresh once cron infrastructure exists

**Test surface**: admin clicks "Refresh Smartpoint list" → cache populates
with smartpoint rows; query shows them with shop_kind=7.

---

### Phase 7 — Pickup point columns + LocationPicker component

**Concerns advanced**: B, C

The UX for locker/branch selection at checkout.

**Database**:

- Migration `orders_pickup_columns.sql`:
  - `ALTER TABLE orders ADD COLUMN pickup_carrier text`
  - `ALTER TABLE orders ADD COLUMN pickup_station_id text`
  - `ALTER TABLE orders ADD COLUMN pickup_branch_id int`
  - `ALTER TABLE orders ADD COLUMN pickup_type text CHECK (pickup_type IN ('locker', 'branch', null))`

**Code**:

- New component `src/components/features/checkout/LocationPicker/`:
  - Props: `carrier, recipientZip, deliveryMethod, onSelect`
  - Tabs (branch / locker) filtered by carrier capabilities
  - Top-10 closest results by haversine from anchor zipcode
  - Address-based search re-anchors
  - "Επιλέξτε αργότερα" row for BoxNow if `defer_locker_selection` ON
- Wire into `CheckoutForm.tsx`:
  - Render `<LocationPicker>` when delivery is `delivery_station_pickup` or
    `carrier_pickup`
  - On select, save to local state + submit with `placeOrder`
- Update `placeOrder.ts` to accept pickup columns and persist to order

**Test surface**: pick a BoxNow order, see only locker tab, pick a locker,
order persists with locationId.

---

### Phase 8 — ACS createVoucher + finalize batch

**Concerns advanced**: C

Closes the order placement loop. Order can actually ship via ACS.

**Code**:

- Implement `AcsProvider.createVoucher(ctx)`:
  - Build payload from order + customer
  - For pickup orders: set `Acs_Station_Destination = order.pickup_station_id`,
    add `REC` to `Acs_Delivery_Products`
  - For Smartpoint orders: ensure `Recipient_Cellphone` is set
  - Handle service combinations carefully (per ACS docs — some can't
    co-exist, e.g., SAT+REC)
  - Return voucher number to caller
- Implement `Issue_Pickup_List` call as `AcsProvider.finalizeBatch(dateRange)`
- New server action `src/actions/orders/createCarrierVoucher.ts`:
  - Called from admin order page button
  - Calls `provider.createVoucher()`, writes `tracking_number` to order
- New admin page `/admin/operations/daily-handoff`:
  - List today's pending vouchers per carrier
  - One-click "Close batch" calls `finalizeBatch()` per carrier
- Implement `AcsProvider.fetchTracking(voucherNo)`:
  - Calls `Trackingsummary` + `TrackingDetails`
  - Returns parsed checkpoint list + current status
- New cron-triggered server action `src/actions/orders/refreshTracking.ts`:
  - Iterates orders with `status` in shipped phases
  - Calls `provider.fetchTracking()` for each (with `fetch_tracking` ON)
  - Maps response via `provider.mapNativeStatus()`
  - Writes back `status`, `carrier_raw_status`, `carrier_status_label`,
    `status_set_by='api'`
- `AcsProvider.cancelVoucher(voucherNo)` implementation

**Test surface**: place an order, click "Create voucher" → tracking number
populates; cancel from admin → API cancel succeeds.

---

### Phase 9 — Custom carrier admin UI

**Concerns advanced**: B

Admin can create, edit, delete custom carriers.

**Code**:

- Extend `/admin/settings/couriers` page:
  - "+ Νέος custom courier" button → form
  - Form fields: `display_name`, `supported_delivery_methods` (multi-select),
    `tracking_url_template`, `timeline_preset` (dropdown of presets or
    "custom" → status code multi-select)
  - Slug auto-generated from display_name (`custom_van_abc123` format)
  - `is_custom=true` automatically
- Edit/delete rows for custom carriers
- Built-in rows show same form but with most fields read-only
- Capability section hidden for custom carriers (no provider class)

**Test surface**: create "Παράδοση δικιά μας", toggle visible, see it appear in
checkout's carrier dropdown.

---

### Phase 10 — Cache infrastructure: unified tables + weekly cron

**Concerns advanced**: A, C

Prepare for multi-carrier directory caching.

**Database**:

- Migration `couriers_location_cache.sql`:
  - New table keyed by `(carrier, country, kind, location_id)`
  - Migrate data from `acs_station_cache` → `couriers_location_cache` with
    `carrier='acs'`
- Migration `couriers_postcode_cache.sql`:
  - New table keyed by `(carrier, country, zipcode)`
  - Migrate from `acs_postcode_cache`

**Code**:

- Update `acs.ts` cache read/write to use new tables
- New server action `src/actions/courier-cron/refreshDirectories.ts`:
  - Iterates `listActiveCarriers()`
  - For each carrier with `list_*` capabilities, calls `provider.listStations()`
    per kind and refreshes cache
- `supabase/migrations/refresh_directories_cron.sql`:
  - pg_cron schedule: weekly, calls server action via Edge Function or similar
  - Alternative: external cron (Vercel cron) calling the action endpoint

**Test surface**: manually trigger refresh, verify cache rows updated with
fresh `cached_at`.

---

### Phase 11 — BoxNow integration

**Concerns advanced**: C

Second carrier. Tests the abstraction.

**Code**:

- New file `src/lib/courier/providers/boxnow.ts`:
  - `BoxNowProvider` class implementing `CarrierProvider`
  - OAuth client_credentials lifecycle (cache token, refresh on 401)
  - `/destinations` (locker listing), `/origins` (warehouse listing)
  - `/delivery-requests` (create)
  - `/parcels/{id}/label.pdf` (label fetch)
  - `/parcels/{id}:cancel`
  - Tracking endpoint
- New types `BoxNowConfig`, `BoxNowSecrets`
- Bucket-size mapping helper: `mapCartToBoxNowSize(cart): 1 | 2 | 3`
- Add to `loadCarrierProvider` switch
- Status mapping function `mapBoxNowState` per [status vocabulary](#status-vocabulary)
- BoxNow row in `CarrierProviderForm.tsx`:
  - OAuth client ID + secret fields
  - Sandbox URL field
  - Capability checkboxes filtered to BoxNow's set
- COD cap validation (€5000) at order placement
- "Any-apm" (locationId=2) handling: option in LocationPicker
- Seed `tracking_url_template` for BoxNow row

**Test surface**: register BoxNow sandbox creds → activate → BoxNow appears
in locker delivery; place order → voucher creates; tracking updates.

---

### Phase 12 — Geniki integration

**Concerns advanced**: C

Third carrier. SOAP protocol, finalize step required.

**Code**:

- New file `src/lib/courier/providers/geniki.ts`:
  - SOAP client via `soap` npm package OR generated client from WSDL
  - `Authenticate` token lifecycle (cache `authKey`, refresh on `Result=11`)
  - `GetShopsList`, `GetLockersList`
  - `CreateJob`, `CancelJob`
  - `ClosePendingJobs` (finalize)
  - `TrackAndTrace` for tracking
  - `GetVouchersPdf` for labels
- New types `GenikiConfig`, `GenikiSecrets`
- Status mapping function `mapGenikiCheckpoint`
- Service code translation (`ΒΡ` for branch reception, `ΑΡ` for branch+COD,
  etc.)
- Geniki row in `CarrierProviderForm.tsx`
- Seed `tracking_url_template`

**Test surface**: register Geniki test creds → activate → orders flow through;
status updates via TrackAndTrace.

---

### Phase 13 — Cart eligibility + smart routing (deferred)

**Concerns advanced**: A, C

Per Q4, when business demands.

**Code** (sketch):

- Each provider implements `canFulfilCart(cart): { ok: boolean; reason?: string }`
- Compatibility helper consults `canFulfilCart` in addition to structural support
- UI surfaces "Δεν χωράει σε BoxNow" tooltip when carrier is incompatible with cart
- Optional: cheapest-carrier recommendation algorithm

### Phase 14 — Returns flow (future)

**Concerns advanced**: C

Per business demand. Geniki has rich return APIs; ACS/BoxNow have partial.
Defer until merchant requests.

---

## Architecture decision records

### ADR-1: Delivery method enum has 4 distinct values

`home_delivery`, `store_pickup`, `delivery_station_pickup`, `carrier_pickup`
are conceptually distinct. We don't collapse locker + branch into one "pickup"
because the API field that selects between them is carrier-specific (ACS uses
station_id space; BoxNow uses locationId; Geniki uses service code).

### ADR-2: Compatibility matrix is the single source of truth

`src/config/checkout-compatibility.ts` is imported by both client UI and
server placeOrder. No duplicated business rules.

### ADR-3: Carriers are data, not enum

The carrier set is a DB table (`delivery_carriers`), seeded with built-ins
and extended by admin-created customs. The enum is too rigid for the
multi-merchant configurability goal.

### ADR-4: Per-data-type caching strategies

Directories (pre-fetch), postcode resolution (lazy), price quotes (never
cache). Don't apply uniform caching.

### ADR-5: Provider interface abstracts protocol differences

ACS (REST-as-RPC), BoxNow (OAuth REST), Geniki (SOAP) — the `CarrierProvider`
interface hides this. Each provider class encapsulates auth lifecycle, request
serialization, field naming.

### ADR-6: Auto-reset over modal blocking on field conflicts

When a user changes (delivery, payment, carrier) and orphans another, silently
switch to a valid default rather than blocking. Less friction; always lands in
a valid state.

### ADR-7: One order = one carrier = one voucher (for now)

We don't split shipments across carriers within an order. May change if
business demands (Q9).

### ADR-8: Customer never picks an inactive carrier

Active-carrier filtering happens server-side; customer-facing UI hides
inactive carriers entirely.

### ADR-9: API capability granularity is per-config, not all-or-nothing

Each `carrier_provider_configs.config.capabilities` block enables/disables
individual integration features. Merchants choose which parts of an integration
they want to use.

### ADR-10: Shared status vocabulary + per-carrier timelines

The status codes are shared (`StatusCode` union, ~18 values). The timeline
(which codes apply, in what order) is per-carrier. The API mapping translates
carrier-native codes to/from shared codes. This preserves both cross-carrier
reporting and per-carrier richness.

### ADR-11: Customer-facing labels are per-status, not per-carrier

`STATUS_LABELS` is a single table per audience (admin Greek, customer Greek).
Carriers don't have their own label sets — the underlying codes are shared.

### ADR-12: TypeScript carrier slug is string at runtime, narrow for built-ins

`CarrierSlug = string`; `BuiltInCarrierSlug` is a narrow union for places
needing exhaustiveness. Runtime safety via Zod + DB FK; type system is
ergonomics, not security.

### ADR-13: Tracking URL is template + voucher, with per-order override

`delivery_carriers.tracking_url_template` + `orders.tracking_number` is the
default path. `orders.tracking_url_override` handles one-off exceptions.

### ADR-14: Phase axis is derived, not stored

5-6 phase buckets are computed from `StatusCode` at read time via `PHASE_OF`
lookup. Stored status is the truth; phase is presentation/grouping.

---

## File-level map

### Existing files

```
src/
  config/
    storefront.ts                       enums (will keep CARRIERS as legacy alias during Phase 0 migration)
    checkout-compatibility.ts           compatibility matrix + helpers + isCompatible
  lib/
    courier/
      provider.ts                       CarrierProvider interface
      registry.ts                       loadCarrierProvider, testCarrierProvider
      quote.ts                          fetchCarrierQuote (cache + provider orchestration)
      encryption.ts                     AES-256-GCM secrets
      providers/
        acs.ts                          AcsProvider
  types/
    carrier-provider.ts                 AcsConfig, AcsSecrets, CarrierProviderConfig
  actions/
    courier-settings/                   admin actions (upsert/delete/test/setActive/listAcsStations)
    checkout/
      placeOrder.ts                     uses isCompatible + fetchCarrierQuote + resolveFees
      previewFees.ts                    read-only fee preview for checkout UI
  components/
    features/checkout/
      CheckoutForm.tsx                  uses compatibility helpers + auto-reset + fee preview
    admin/courier-settings/
      CarrierProviderForm.tsx           ACS-only enforced today
      CarrierProviderRowActions.tsx
  app/
    admin/settings/couriers/
      page.tsx
supabase/migrations/
  20260519000001_carrier_pickup_delivery_method.sql
  20260520000001_fees_foundation.sql
  20260520000002_orders_fees_breakdown.sql
  20260520000003_variant_weight_kg.sql
  20260520000004_carrier_provider_configs.sql
  20260521000001_acs_caches.sql
docs/features/API Documentations/Couriers/
  ACS.md                                ACS REST API reference
  BoxNow.md                             BoxNow API reference
  GenikiTaxidromiki.md                  Geniki SOAP API reference
```

### Planned

```
src/
  config/
    status-vocabulary.ts                StatusCode, STATUS_LABELS, PHASE_OF, Phase
    status-timelines.ts                 TIMELINE_BY_CARRIER + getTimelineForOrder
  lib/courier/
    listActiveCarriers.ts               server helper (Phase 1)
    getCapabilities.ts                  resolve effective capabilities (Phase 4)
    buildTrackingUrl.ts                 tracking URL builder (Phase 3)
    providers/
      boxnow.ts                         (Phase 11)
      geniki.ts                         (Phase 12)
  components/features/checkout/
    LocationPicker/
      index.tsx                         (Phase 7)
      ProximityList.tsx
      TypeTabs.tsx
  actions/
    orders/
      createCarrierVoucher.ts           (Phase 8)
      refreshTracking.ts                (Phase 8)
    courier-cron/
      refreshDirectories.ts             (Phase 10)
  app/admin/operations/daily-handoff/
    page.tsx                            (Phase 8)
supabase/migrations/
  couriers_table.sql                    (Phase 0)
  orders_carrier_slug_fk.sql            (Phase 0)
  carrier_provider_configs_fk.sql       (Phase 0)
  expand_fulfillment_status.sql         (Phase 2)
  orders_status_audit_fields.sql        (Phase 2)
  carriers_tracking_url.sql             (Phase 3)
  orders_tracking_fields.sql            (Phase 3)
  orders_pickup_columns.sql             (Phase 7)
  couriers_location_cache.sql           (Phase 10)
  couriers_postcode_cache.sql           (Phase 10)
```

---

## API glossary

| Term | API | Meaning |
|---|---|---|
| `Acs_Station_Destination` | ACS | 2-3 letter Greek code identifying the ACS facility (central/sub/Smartpoint) |
| `Acs_Station_Branch_Destination` | ACS | 0 or 1 — sub-branch index within a station |
| `ACS_SHOP_KIND` | ACS | 1=central, 2/3=sub, 4=Xpress (COD-only), 5=Kiosk (envelopes), 7=Smartpoint (locker, ≤6kg) |
| `Acs_Delivery_Products` | ACS | Comma-separated service flags (REC=reception, REM=remote, COD=COD, SAT=Saturday, etc.) |
| `Inaccessible_Area_Kind` | ACS | "ΔΠ" = δυσπρόσιτη περιοχή (inaccessible/remote) |
| `Issue_Pickup_List` | ACS | Batch-close call required before physical handoff |
| `shipment_status` | ACS | Numeric code (1=refusal, 2=unknown recipient, 3=absent, 4=delivered, 5=in transit/various) |
| `non_delivery_reason_code` | ACS | Fine-grained sub-reason (ΑΣ1, ΑΠ1, ΛΣ1, etc.) |
| `paymentMode` | BoxNow | "prepaid" or "cod" |
| `amountToBeCollected` | BoxNow | COD amount, 0–5000 EUR |
| `locationId` | BoxNow | Locker ID; special value 2 = "any-apm" (customer picks at delivery) |
| `requiredSize` | BoxNow | Compartment bucket: 1=small, 2=medium, 3=large |
| `paymentState` | BoxNow | "pending" → "paid-by-customer" → "transferred-to-partner" |
| `state` | BoxNow | new · intransit · wait-for-load · in-final-destination · delivered · expired-return · returned · cancelled · lost · missing |
| `authKey` | Geniki | Per-session token from `Authenticate` |
| `Services` | Geniki | Comma-separated 2-char service codes (ΒΡ=branch reception, ΑΡ=branch+COD, ΑΜ=COD cash, etc.) |
| `ClosePendingJobs` | Geniki | Batch-close call required before physical handoff |
| `Vendor` | Geniki | The locker network operating a third-party locker (e.g. potentially BoxNow) |
| Checkpoint codes (`C_*`) | Geniki | Granular status codes (C_NW, C_KK, C_A1, C_H1, C_A3, C_W2, C_W3, C_EA_*, C_E1, C_P4, C_D2, etc.) |
