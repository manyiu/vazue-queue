# Fairness and throughput

Visitors receive a **FIFO position** at enroll. The **serving** counter advances on a schedule and when visitors are admitted or expire.

## FIFO fairness

1. Each enroll gets a monotonically increasing **position**
2. **Serving** counter tracks how far the queue has advanced
3. Visitor is admitted when `position <= serving` (or `emergency_open` override)
4. Same `session_id` → same visitor (idempotent enroll)

No "skip the line" via refresh — position is tied to session.

## Throughput

`throughput_per_minute` on the event controls how fast serving advances.

**Serving reaper** (EventBridge, every 1 minute):

- Adds `throughput_per_minute` to `serving`
- Cleans up expired visitors at the front

Live overrides from admin API can pause, throttle, or open floodgates without redeploying.

## Adaptive polling

Status API returns `poll_after_seconds` based on distance from front:

| Distance from front | Poll interval |
|---------------------|---------------|
| &lt; 50 | 2s |
| &lt; 500 | 5s |
| else | 30s |

Visitors near the front poll more often; back-of-queue pollers reduce origin RPS.

## Capacity planning

There is **no fixed visitor ceiling** in the queue kernel — throughput depends on **AWS quotas** (Lambda concurrency, API Gateway RPS, DynamoDB) and preset choice (`standard` adds CloudFront status caching).

Pollers spend most time **sleeping** — many waiting visitors do not mean equal Lambda concurrency:

```
concurrent ≈ pollers × (request_duration / (request_duration + sleep))
           ≈ 10,000 × (0.04s / 2.04s) ≈ 200   (example at 2s poll, 40ms p95)
```

[Full capacity guide →](/docs/guides/capacity)

## Enroll burst vs polling

Load tests treat these separately (see [Capacity planning](/docs/guides/capacity) for AWS quota context):

- **Status polling:** baseline validated on default AWS account quotas (in-region)
- **Enroll burst:** ~1K unique simultaneous enrolls on buffered `standard` (~0% fail, p95 ~700–850ms in reference runs) — can approach Lambda's default **1,000 concurrent-execution quota per Region** (account-wide; [request increase](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html))

Flash on-sale traffic is enroll-heavy. Plan for both.
