# Capacity and performance

Honest guidance for planning flash-traffic events. These numbers are **measured in-region on AWS** with default account quotas — not a maximum visitor count for Vazue Queue itself.

## No fixed visitor ceiling

Vazue Queue does **not** cap how many visitors can wait in line. Scale is bounded by **AWS service quotas and stack configuration** in the operator account:

| AWS limit (typical default) | Effect at scale |
|-----------------------------|-----------------|
| Lambda concurrent executions (~1,000/region) | Caps simultaneous enroll/status invocations |
| API Gateway HTTP API RPS | Caps request rate before throttling |
| DynamoDB on-demand throughput | Scales with traffic; hot keys matter for single-event tests |
| CloudFront | Offloads status polling on `standard` / `full` presets |

Load tests document what a **reference stack on default quotas** achieved. Larger events require [quota increases](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html) and often the `standard` preset (CloudFront status cache) — same as any serverless architecture on AWS.

::: tip Read this correctly
**~10,000 concurrent pollers** in our baseline test means “validated on default AWS limits,” not “product max is 10K.” A 100K-poller exploratory run hit **AWS throttling**, not an application error — see table below.
:::

## Validated (in-region load tests)

### Status polling

Tests use `scripts/load-test-status.js`: each virtual user polls `GET /v1/events/{id}/status` with adaptive `sleep(poll_after_seconds)` — the same pattern as the waiting room UI.

| Concurrent status pollers | Preset tested | Fail rate | p95 latency | Record |
|---------------------------|---------------|-----------|-------------|--------|
| **~1,000** | `minimal` | 0% | ~34ms | [load-test-rc-2026-08-22-inregion](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-rc-2026-08-22-inregion.md) |
| **~10,000** | `minimal` | 0.03% | ~39ms | [load-test-10k-2026-08-28](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-10k-2026-08-28.md) |
| **~1,000** | `standard` (CloudFront status) | 0% | ~3ms | [load-test-standard-2026-08-29](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-standard-2026-08-29.md) |
| **~100,000** | `minimal` (10 workers) | ~71% | ~202ms* | [load-test-100k-2026-08-28](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-100k-2026-08-28.md) — **not a product gate**; throttled without quota increases |

### Enroll burst

Tests use `scripts/load-test-enroll.js`: each virtual user performs one unique `POST …/enroll` (flash-traffic / on-sale shape).

**Reference-stack enroll SLO (not a release gate):** fail &lt; 1%, POST p95 typically **~700–850ms** at 1K simultaneous unique enrolls in-region on `standard` + buffer (512 MB Lambda). Latency varies run-to-run when every VU cold-starts a new Lambda; reliability is the meaningful gate.

| Concurrent unique enrolls | Preset tested | Fail rate | p95 latency | Record |
|---------------------------|---------------|-----------|-------------|--------|
| **~1,000** | `minimal` (sync) | 0.1% | ~1406ms | [load-test-enroll-2026-08-29](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-enroll-2026-08-29.md) |
| **~1,000** | `standard` (buffered) | 0% | ~688–839ms | [load-test-enroll-standard-2026-08-29](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-enroll-standard-2026-08-29.md) |

\*p95 on **successful** requests only when fail rate is high.

**Baseline on default AWS quotas (reference stack):** in-region tests on a default `minimal` data plane (512 MB Lambda, enroll buffer off) reached **~10,000 concurrent status pollers** at RC SLOs (fail &lt; 1%, p95 &lt; 250ms) with clients in the **same region** as the stack. This is a **quota/configuration baseline**, not a product limit.

## How closely does this match production?

| Aspect | Load test | Typical production (`standard` preset) |
|--------|-----------|----------------------------------------|
| Status polling loop | Same as waiting room (`poll_after_seconds` + GET status) | Same |
| Client geography | k6 in **us-east-1** | Global visitors — cross-region RTT adds latency (see [HKT miss record](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-rc-2026-08-21.md)) |
| Stack shape | `minimal` — API Gateway → Lambda → DynamoDB | **`standard`** adds CloudFront; status polls can be **edge-cached** (2–30s TTL keyed by `request_id`) → **less origin load than our tests** for repeated polls |
| Visitor keys | All pollers share **one** `request_id` (worst-case hot read) | One DynamoDB item per visitor — **spread read load** |
| Poll interval | Near-front visitor → often **2s** between polls | Back of queue → up to **30s** — **lower RPS** per poller when far from front |
| Enroll burst | `scripts/load-test-enroll.js` (one unique enroll per VU) | Flash traffic **enrolls many new visitors** — run in-region to record; status-only tests still use one shared `request_id` |
| AWS quotas | Default account limits (Lambda concurrency **1,000**/region, API Gateway RPS limits) | Same unless quota increases are requested |

**Summary:** Status polling behavior is realistic. The **`minimal` tests are a reasonable lower bound** for origin stress; **`standard` + CloudFront may perform better** for steady polling. **Enroll burst at 1K concurrent unique enrolls:** sync `minimal` ~0.1% fail / p95 ~1.4s; buffered `standard` **0% fail / p95 ~700–850ms** (see [load-test-enroll-2026-08-29](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-enroll-2026-08-29.md) and [load-test-enroll-standard-2026-08-29](https://github.com/manyiu/vazue-queue/blob/main/docs/launch/load-test-enroll-standard-2026-08-29.md)) — buffer roughly halves POST latency under flash load. Global RTT is **not** fully covered. Published poller counts describe **AWS-validated baselines**, not “maximum visitors supported.”

## Why many pollers ≠ many concurrent Lambdas

Each poller spends most of its time **sleeping** between polls, not inside Lambda:

```
cycle ≈ GET status (~40ms) + sleep (poll_after_seconds, often 2–5s)
```

Rough concurrent origin executions:

```
concurrent ≈ pollers × (request_duration / request_duration + sleep)
           ≈ 10,000 × (0.04s / 2.04s) ≈ 200   (example at 2s poll, 40ms p95)
```

Adaptive intervals from the API ([`adaptive_poll_interval_secs` on GitHub](https://github.com/manyiu/vazue-queue/blob/main/packages/core-rust/crates/queue-kernel/src/wait.rs)):

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

## Scaling beyond default AWS quotas

Without quota increases, **~100K concurrent pollers** hit **AWS throttling** in an exploratory run — not an application-level rejection. To scale further:

1. Request **Lambda concurrent execution** and **API Gateway** limit increases (cost/account review).
2. Use **`standard`** or **`full`** preset so CloudFront caches status polls.
3. Run a custom gate: `VUS=10000 WORKERS=1 bash scripts/run-load-test-100k-inregion.sh` (see [Load test](/docs/guides/deploy#load-test)).
4. Model cost: `npx vazue-queue cost --visitors N --minutes M --poll 5` — see [AWS cost estimate](/docs/guides/cost).

## Reproduce

```bash
# 1K RC gate (ephemeral stack + CodeBuild)
bash scripts/run-load-test-rc-inregion.sh

# 1K enroll burst (unique enroll per VU)
bash scripts/run-load-test-enroll-inregion.sh

# 1K buffered enroll burst (`standard` preset)
bash scripts/run-load-test-enroll-standard-inregion.sh

# 10K status pollers (single worker)
SKIP_BUILD=1 VUS=10000 WORKERS=1 bash scripts/run-load-test-100k-inregion.sh
```

Run the generator **in the same region** as the data plane when measuring p95.
