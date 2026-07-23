/**
 * Smoke test — the cheapest possible scenario.
 *
 * Goal: prove the k6 → Next.js → Supabase → response pipe works end-to-end.
 * NOT measuring performance, NOT finding ceilings — just verifying the
 * infrastructure is wired up so subsequent scenarios have a known-good
 * baseline to layer on.
 *
 * Profile:
 *   - 1 virtual user
 *   - 10 iterations (~10 sec total)
 *   - Per iteration: GET / then GET /products/<random-seed-slug>
 *
 * Pass criteria (k6 thresholds):
 *   - 100% of requests return 2xx (no 4xx, no 5xx)
 *   - p95 latency < 2000ms (dev server is slow first-paint; this is generous)
 *   - Average request rate is meaningful (i.e., k6 actually executed iterations)
 *
 * Failure modes this catches:
 *   - Dev server not running                 → connection refused
 *   - Dev server on wrong env (remote DB)    → 200s but maybe slow / different data
 *   - Routes broken                          → 4xx/5xx
 *   - Seed missing                           → product detail page 404s
 *   - k6 misconfigured                       → no requests, no metrics
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, PATHS, SEED_PRODUCT_SLUGS } from "../lib/config.js";

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: {
    http_req_failed: ["rate<0.01"],        // < 1% errors
    http_req_duration: ["p(95)<2000"],     // 95% of requests under 2s
    "checks{check:home_ok}": ["rate>0.99"],
    "checks{check:product_ok}": ["rate>0.99"],
  },
};

export default function () {
  // 1. Storefront homepage
  const homeRes = http.get(`${BASE_URL}${PATHS.HOME}`, {
    tags: { name: "GET /" },
  });
  check(
    homeRes,
    {
      "home_ok": (r) => r.status === 200,
      "home has html": (r) => (r.body || "").length > 100,
    },
    { check: "home_ok" }
  );

  // 2. A random product detail page
  const slug = SEED_PRODUCT_SLUGS[Math.floor(Math.random() * SEED_PRODUCT_SLUGS.length)];
  const productRes = http.get(`${BASE_URL}${PATHS.PRODUCT_DETAIL(slug)}`, {
    tags: { name: "GET /products/:slug" },
  });
  check(
    productRes,
    {
      "product_ok": (r) => r.status === 200,
      "product has html": (r) => (r.body || "").length > 100,
    },
    { check: "product_ok" }
  );

  // Small pause between iterations so we don't pummel the dev server with
  // back-to-back requests at the speed of light. Smoke isn't about load.
  sleep(0.5);
}
