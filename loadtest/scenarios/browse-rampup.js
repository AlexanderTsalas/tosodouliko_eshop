/**
 * Browse scale-up — find the storefront read-path ceiling AND surface the
 * silent fetch-failure degradation we discovered after the first run.
 *
 * Profile (ramping arrival rate, reduced peak for 8GB-constrained host):
 *   0:00 → 0:20  ramp     1 → 15  req/s
 *   0:20 → 0:50  hold @  15 req/s
 *   0:50 → 1:10  ramp   15 → 35  req/s
 *   1:10 → 1:40  hold @  35 req/s
 *   1:40 → 2:00  ramp   35 → 50  req/s
 *   2:00 → 2:30  hold @  50 req/s
 *   2:30 → 2:50  cooldown to 0
 *
 * Total wall-clock: ~2:50
 *
 * Lower peak (50 vs prior 150) because:
 *   1. Host (8GB RAM) starts memory-constrained — high rates cause Node
 *      to fail outbound fetches to PostgREST, not because of "real"
 *      saturation but because of hardware noise.
 *   2. We learned from the prior run that the system silently degrades at
 *      30+ req/s (getContestableAvailableForVariants RPC fetch fails →
 *      defensive fallback returns 0 inventory → product pages render in
 *      "out of stock" mode). 50 is enough to see this happen reliably
 *      without overwhelming the host.
 *
 * DEEPER CHECKS — the prior run only verified HTTP 200 + non-empty body.
 * That allowed the silent fetch-failure degradation to pass undetected.
 * Now we also verify product-page HTML contains the in-stock CTA
 * ("Προσθήκη στο καλάθι"). If degradation kicked in, that text is
 * absent (replaced by the Notify-me CTA) — the check fails and k6
 * reports the real degradation rate, not the false-positive 100%.
 *
 * Thresholds stay informational (not abort-triggers).
 */

import http from "k6/http";
import { check } from "k6";
import { BASE_URL, PATHS, SEED_PRODUCT_SLUGS } from "../lib/config.js";

export const options = {
  scenarios: {
    browse_rampup: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 25,        // lower than before — less RAM upfront
      maxVUs: 150,                // hits-this-cap is still a saturation signal
      stages: [
        { target: 15, duration: "20s" },
        { target: 15, duration: "30s" },
        { target: 35, duration: "20s" },
        { target: 35, duration: "30s" },
        { target: 50, duration: "20s" },
        { target: 50, duration: "30s" },
        { target: 0,  duration: "20s" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{name:GET /}":               ["p(95)<400"],
    "http_req_duration{name:GET /products/:slug}": ["p(95)<600"],
    // NEW — degradation detector. If silent fetch failures push product
    // pages into "out of stock" rendering, this check fails. The threshold
    // is intentionally strict — even a small fraction of degraded pages
    // is a meaningful finding.
    "checks{check:add_to_cart_present}":           ["rate>0.99"],
  },
};

export default function () {
  if (Math.random() < 0.5) {
    // Homepage
    const res = http.get(`${BASE_URL}${PATHS.HOME}`, {
      tags: { name: "GET /" },
    });
    check(
      res,
      {
        "home_status_200": (r) => r.status === 200,
        "home_has_body": (r) => (r.body || "").length > 100,
      },
      { check: "home" }
    );
  } else {
    // Product detail — random slug
    const slug = SEED_PRODUCT_SLUGS[
      Math.floor(Math.random() * SEED_PRODUCT_SLUGS.length)
    ];
    const res = http.get(`${BASE_URL}${PATHS.PRODUCT_DETAIL(slug)}`, {
      tags: { name: "GET /products/:slug" },
    });
    const body = res.body || "";
    check(
      res,
      {
        "product_status_200": (r) => r.status === 200,
        "product_has_body": () => body.length > 100,
        // The critical new check: the "Add to cart" CTA must be present.
        // When getContestableAvailableForVariants fails (the silent
        // degradation discovered after the first run), the page falls
        // back to "Notify me" — Προσθήκη στο καλάθι would be absent.
        "add_to_cart_present": () => body.includes("Προσθήκη στο καλάθι"),
      },
      { check: "add_to_cart_present" }
    );
  }
}
