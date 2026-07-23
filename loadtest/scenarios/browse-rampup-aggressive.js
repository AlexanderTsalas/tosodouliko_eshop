/**
 * Browse scale-up — AGGRESSIVE peak (150 req/s).
 *
 * Same shape as browse-rampup.js but pushes 3× harder. Use this variant
 * to probe the actual ceiling, NOT for routine runs.
 *
 * Profile (ramping arrival rate):
 *   0:00 → 0:30  ramp     1 → 25  req/s
 *   0:30 → 1:00  hold @  25 req/s
 *   1:00 → 1:30  ramp   25 → 75  req/s
 *   1:30 → 2:00  hold @  75 req/s
 *   2:00 → 2:30  ramp   75 → 150 req/s
 *   2:30 → 3:00  hold @ 150 req/s
 *   3:00 → 3:30  cooldown to 0
 *
 * Total wall-clock: ~3.5 min
 *
 * PREREQUISITES — read before running:
 *   1. CLOSE VS Code, Claude, browser tabs except localhost:3000. Free RAM
 *      is essential — prior run with everything open saw thousands of
 *      "fetch failed" errors that turned out to be hardware-induced.
 *   2. Prod build running:  npm run build:localstack && npm run start:localstack
 *   3. Local Supabase up, DB seeded.
 *   4. Have Studio's SQL Editor open with the connection-count probe ready;
 *      sample at 1:30, 2:15, 2:45 to capture pool behavior at each rate.
 *
 * Includes the deeper checks from browse-rampup.js — if the silent
 * degradation kicks in again, k6 will flag it via add_to_cart_present.
 */

import http from "k6/http";
import { check } from "k6";
import { BASE_URL, PATHS, SEED_PRODUCT_SLUGS } from "../lib/config.js";

export const options = {
  scenarios: {
    browse_rampup_aggressive: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { target: 25,  duration: "30s" },
        { target: 25,  duration: "30s" },
        { target: 75,  duration: "30s" },
        { target: 75,  duration: "30s" },
        { target: 150, duration: "30s" },
        { target: 150, duration: "30s" },
        { target: 0,   duration: "30s" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{name:GET /}":               ["p(95)<400"],
    "http_req_duration{name:GET /products/:slug}": ["p(95)<600"],
    "checks{check:add_to_cart_present}":           ["rate>0.99"],
  },
};

export default function () {
  if (Math.random() < 0.5) {
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
        "add_to_cart_present": () => body.includes("Προσθήκη στο καλάθι"),
      },
      { check: "add_to_cart_present" }
    );
  }
}
