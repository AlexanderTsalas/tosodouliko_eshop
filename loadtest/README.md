# Load testing — kids_eshop

k6 scenarios for measuring the app's behavior under synthetic traffic.

## Folder layout

```
loadtest/
├── seeds/       seed scripts + a .md per seed describing what it produces
├── scenarios/   reusable k6 scenarios — each independent of which seed it runs against
├── lib/         shared config (BASE_URL, route templates, seed product slugs)
└── runs/        results, organized as runs/<seed>/<scenario>/<env>/<timestamp>(-summary).json
                 (the *.json files are gitignored — large, ephemeral, machine-specific)
```

## Naming convention for runs

Every result file lives at:

```
loadtest/runs/<seed-name>/<scenario-name>/<env>/<YYYYMMDD-HHMMSS>(-summary).json
```

where:

- `<seed-name>` = filename in `seeds/` without the `.mjs` extension (e.g., `thin`)
- `<scenario-name>` = filename in `scenarios/` without the `.js` extension (e.g., `smoke`, `browse-rampup`)
- `<env>` = `dev` or `prod` — whether the app was running via `npm run dev:localstack` or `npm run build:localstack && npm run start:localstack`

This lets you read any result's path and know the full context of the test that produced it.

## Prerequisites — every run

1. **Local Supabase stack up** — `npx supabase start`
2. **Local DB seeded** — `npx supabase db reset --local && npm run seed:<seed>` (e.g., `seed:thin`)
3. **Next.js running against local stack** — either:
   - **dev mode** (fast iteration, slow + noisy numbers): `npm run dev:localstack`
   - **prod mode** (slow build, fast + clean numbers): `npm run build:localstack && npm run start:localstack`
4. **k6 installed** — `k6 version` should print a version number

Skipping any of these will either time out, hit empty data, or pollute remote Supabase.

## Running a scenario

```bash
# Define once per terminal session so each run gets its own folder
SEED=thin
SCENARIO=smoke
ENV=prod
TS=$(date +%Y%m%d-%H%M%S)
OUT=loadtest/runs/$SEED/$SCENARIO/$ENV

mkdir -p $OUT

k6 run --out json=$OUT/$TS.json \
       --summary-export $OUT/$TS-summary.json \
       loadtest/scenarios/$SCENARIO.js
```

Or, as a one-liner:

```bash
k6 run \
  --out json=loadtest/runs/thin/smoke/prod/$(date +%Y%m%d-%H%M%S).json \
  --summary-export loadtest/runs/thin/smoke/prod/$(date +%Y%m%d-%H%M%S)-summary.json \
  loadtest/scenarios/smoke.js
```

(If you find yourself running this often, an npm script wrapper would be a good next step — `npm run loadtest -- thin smoke prod` could construct the path automatically.)

## Reading results

k6 prints a summary at end-of-run. Six numbers matter:

| Metric | Meaning | Health check |
|---|---|---|
| `http_reqs` rate | Actual throughput achieved | Should match the scenario's target — lower means the server saturated |
| `http_req_duration` p95 | 95% of requests finished under this | Watch the trend across stages |
| `http_req_duration` p99 / max | Tail latency | Spikes here matter more than averages do |
| `http_req_failed` rate | Non-2xx rate | < 1% ideal, anything above is a quality signal |
| `iteration_duration` | Full scenario walk-through | End-to-end UX proxy |
| `vus` / `vus_max` | Active virtual users | Correlate with "what load was active when latency spiked?" |

Anything in red = threshold violated.

The full firehose JSON (`<timestamp>.json` with no `-summary` suffix) has every request as JSONL — use it for time-series analysis when the summary leaves a question open.

## Conventions

- **Scenarios are seed-agnostic in code.** They import `SEED_PRODUCT_SLUGS` from `lib/config.js`; that constant gets updated alongside seed changes.
- **One scenario = one file.** Don't chain unrelated scenarios.
- **Run filenames are timestamped.** Sortable directory listings = chronological order.
- **Probes (SQL queries for live DB inspection) live next to scenarios as they're added** — not yet created.
