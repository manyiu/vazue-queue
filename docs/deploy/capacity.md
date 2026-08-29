# Capacity and performance

Honest guidance for planning flash-traffic events. These are **measured in-region on AWS**, not guarantees for every account or geography.

## Validated (in-region load tests)

Tests use `scripts/load-test-status.js`: each virtual user polls `GET /v1/events/{id}/status` with adaptive `sleep(poll_after_seconds)` — the same pattern as the waiting room UI.

| Concurrent status pollers | Preset tested | Fail rate | p95 latency | Record |
|---------------------------|---------------|-----------|-------------|--------|
| **~1,000** | `minimal` | 0% | ~34ms | [`load-test-rc-2026-08-22-inregion.md`](../launch/load-test-rc-2026-08-22-inregion.md) |
| **~10,000** | `minimal` | 0.03% | ~39ms | [`load-test-10k-2026-08-28.md`](../launch/load-test-10k-2026-08-28.md) |
| **~1,000** | `standard` (CloudFront status) | *(run `scripts/run-load-test-standard-inregion.sh`)* | — | — |
| **~100,000** | `minimal` (10 workers) | ~71% | ~202ms* | [`load-test-100k-2026-08-28.md`](../launch/load-test-100k-2026-08-28.md) — **not a product gate**; throttled without quota increases |

\*p95 on **successful** requests only when fail rate is high.

**OSS v1 capacity claim:** plan for **up to ~10,000 concurrent status pollers** on a default `minimal` data plane (512 MB Lambda, enroll buffer off) at RC SLOs (fail &lt; 1%, p95 &lt; 250ms), with clients polling in the **same region** as the stack.

## How closely does this match production?

| Aspect | Load test | Typical production (`standard` preset) |
|--------|-----------|----------------------------------------|
| Status polling loop | Same as waiting room (`poll_after_seconds` + GET status) | Same |
| Client geography | k6 in **us-east-1** | Global visitors — cross-region RTT adds latency (see [HKT miss record](../launch/load-test-rc-2026-08-21.md)) |
| Stack shape | `minimal` — API Gateway → Lambda → DynamoDB | **`standard`** adds CloudFront; status polls can be **edge-cached** (2–30s TTL keyed by `request_id`) → **less origin load than our tests** for repeated polls |
| Visitor keys | All pollers share **one** `request_id` (worst-case hot read) | One DynamoDB item per visitor — **spread read load** |
| Poll interval | Near-front visitor → often **2s** between polls | Back of queue → up to **30s** — **lower RPS** per poller when far from front |
| Enroll burst | One enroll in k6 `setup()` | Flash traffic **enrolls many new visitors** — not characterized by these status-only tests |
| AWS quotas | Default account limits (Lambda concurrency **1,000**/region, API Gateway RPS limits) | Same unless you request increases |

**Summary:** Status polling behavior is realistic. The **`minimal` tests are a reasonable lower bound** for origin stress; **`standard` + CloudFront may perform better** for steady polling. Enroll spikes and global RTT are **not** fully covered. Treat 10K as validated for **concurrent pollers**, not “10K enrolls per second.”

## Why 10K pollers ≠ 10K Lambdas at once

Each poller spends most of its time **sleeping** between polls, not inside Lambda:

```
cycle ≈ GET status (~40ms) + sleep (poll_after_seconds, often 2–5s)
```

Rough concurrent origin executions:

```
concurrent ≈ pollers × (request_duration / request_duration + sleep)
           ≈ 10,000 × (0.04s / 2.04s) ≈ 200   (example at 2s poll, 40ms p95)
```

Adaptive intervals from the API ([`adaptive_poll_interval_secs`](../../packages/core-rust/crates/queue-kernel/src/wait.rs)):

| Distance from front | `poll_after_seconds` |
|---------------------|----------------------|
| &lt; 50 | 2 |
| &lt; 500 | 5 |
| else | 30 |

Steady-state **request rate** (all pollers at the same interval):

```
RPS ≈ pollers / (request_duration + poll_after_seconds)
```

Example: 10,000 pollers, 40ms requests, 2s poll → **~4,900 RPS** to origin on `minimal`. That can approach API Gateway account limits before Lambda concurrency saturates.

## Planning beyond 10K

Without quota increases, **~100K concurrent pollers** hit throttling in our exploratory run. To go higher:

1. Request **Lambda concurrent execution** and **API Gateway** limit increases (cost/account review).
2. Use **`standard`** or **`full`** preset so CloudFront caches status polls.
3. Run your own gate: `VUS=10000 WORKERS=1 bash scripts/run-load-test-100k-inregion.sh` (see [Load test](./oss-cdk.md#load-test)).
4. Model cost: `npx vazue-queue cost --visitors N --minutes M --poll 5`.

## Reproduce

```bash
# 1K RC gate (ephemeral stack + CodeBuild)
bash scripts/run-load-test-rc-inregion.sh

# 10K (single worker)
SKIP_BUILD=1 VUS=10000 WORKERS=1 bash scripts/run-load-test-100k-inregion.sh
```

Run the generator **in the same region** as the data plane when measuring p95.
