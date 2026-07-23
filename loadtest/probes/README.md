# Load-test probes

SQL queries for inspecting the local Postgres while or after a load test runs.

## Two flavors

| Type | When to run | Tells you |
|---|---|---|
| **Live probes** (`during/*.sql`) | While k6 is running. Re-run every 10-30 sec. | What the DB is *doing right now* — active queries, lock waits, connection count. |
| **Post-mortem probes** (`after/*.sql`) | Once, when k6 finishes. | What the test *did in aggregate* — slowest queries, index usage, table activity. |

## How to run

Either copy-paste into **Supabase Studio's SQL Editor** (http://127.0.0.1:54323 → SQL Editor in left sidebar), or via `psql`:

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f loadtest/probes/during/active-queries.sql
```

## Recommended rhythm

```
1. (Studio) SELECT pg_stat_statements_reset();        ← before starting k6
2. Start k6 in terminal 3
3. (Studio) Run during/ probes at ~1, 2, 3 min into the test
4. When k6 finishes: run after/ probes once
5. Compare k6 summary + SQL findings side-by-side
```

The k6 summary tells you *what the user saw* (latency, error rates, throughput). The SQL probes tell you *where the time went* (which query, which lock, which index). You need both to know **why** the system behaved as it did.
