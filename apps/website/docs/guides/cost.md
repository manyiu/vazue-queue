# AWS cost estimate

Vazue Queue bills through **AWS**, not per-visitor SaaS fees. This page explains what drives the bill, how to model an event, and what numbers to expect.

::: warning Not a quote
Figures below use **us-east-1 public list prices** from the built-in estimator. Actual bills vary by region, discounts, free tier, data transfer, and preset options (WAF, Cognito). Use the CLI for planning; validate with AWS Cost Explorer after the first event.
:::

## Quick estimate (CLI)

```bash
npx vazue-queue cost --visitors 100000 --minutes 60 --poll 5
```

| Flag | Meaning | Default |
|------|---------|---------|
| `--visitors` | Unique visitors who enroll | required |
| `--minutes` | How long each visitor polls status | required |
| `--poll` | Average seconds between status polls | `5` |
| `--throughput` | Admits per minute (informational) | `100` |

Example output:

```
Vazue Queue OSS cost estimate (us-east-1, 100,000 visitors × 60 min)
  Enrolls: 100,000
  Status polls (est.): 72,000,000
  API Gateway:  $72.10
  Lambda:       $16.83
  DynamoDB:     $36.38
  CloudFront:   $72.00
  SQS:          $0.04
  Total ≈       $197.34
```

## Example scenarios (us-east-1)

Worst-case model: every visitor enrolls once and polls for the **entire** wait window at a fixed interval. Real events are usually **lower** — see [What lowers the bill](#what-lowers-the-bill).

| Scenario | Visitors | Wait | Poll interval | Est. total |
|----------|----------|------|---------------|------------|
| Small drop | 1,000 | 30 min | 5 s | **~$1** |
| Medium event | 10,000 | 60 min | 5 s | **~$20** |
| Large flash sale | 50,000 | 60 min | 5 s | **~$99** |
| Large flash sale | 100,000 | 60 min | 5 s | **~$197** |
| Same event, slower polling | 100,000 | 60 min | 30 s | **~$33** |
| Long wait window | 100,000 | 120 min | 5 s | **~$394** |

Reproduce any row:

```bash
npx vazue-queue cost --visitors 100000 --minutes 60 --poll 5
npx vazue-queue cost --visitors 100000 --minutes 60 --poll 30
```

## What drives the bill

Almost all spend is **HTTP requests** — one enroll per visitor, then repeated status polls until admission or exit.

```
status_polls ≈ visitors × ceil(wait_minutes × 60 / poll_seconds)
total_requests = enrolls + status_polls
```

| Service | Charged for | Typical share (100K × 60 min, 5 s poll) |
|---------|-------------|----------------------------------------|
| **API Gateway** (HTTP API) | Every enroll + status request | ~37% |
| **CloudFront** | HTTPS to waiting room / cached status (`standard`+) | ~37% |
| **DynamoDB** | Enroll writes + status reads | ~18% |
| **Lambda** | Invocations + duration (128 MB ARM) | ~9% |
| **SQS** | One message per enroll (buffered enroll) | &lt;1% |

The CLI uses these us-east-1 list prices (see `packages/create-vazue-queue/src/cost.ts`):

| Component | Rate used |
|-----------|-----------|
| HTTP API | $1.00 / million requests |
| Lambda | $0.20 / million invocations + GB-seconds |
| DynamoDB | ~3 write units per enroll, ~2 read units per status |
| CloudFront HTTPS | $0.01 / 10,000 requests |
| SQS | $0.40 / million messages |

## What lowers the bill

The CLI assumes fixed 5-second polling for the full wait. Production behavior reduces cost:

1. **Adaptive polling** — the API returns `poll_after_seconds` (2 s near the front, up to 30 s at the back). Back-of-queue visitors poll far less often than the CLI worst case.
2. **CloudFront status cache** (`standard` preset) — repeated status polls for the same `request_id` can be served from the edge (2–30 s TTL), cutting origin API and Lambda invocations.
3. **Shorter effective wait** — visitors who leave before admission stop polling. The CLI assumes everyone polls for the full `--minutes` window.
4. **Admission throughput** — higher `throughput_per_minute` shortens waits, reducing poll count per visitor.

The **~$33 vs ~$197** comparison for 100K visitors (30 s vs 5 s average poll) shows how sensitive the model is to polling behavior.

## Cost by preset

| Preset | Extra AWS components | Estimator includes | Not in CLI (add manually) |
|--------|---------------------|--------------------|---------------------------|
| `minimal` | API + Lambda + DynamoDB | ✓ (no CloudFront in practice) | — |
| `standard` | + CloudFront waiting room | ✓ CloudFront line | Waiting room asset storage (cents) |
| `full` | + Admin (Cognito), WAF, Lambda@Edge | Partial | WAF (~$5/mo + per-request), Cognito MAU, extra CloudFront distributions |

For `full` preset flash events, budget **tens of dollars** for WAF and Cognito on top of the CLI total — order-of-magnitude, not per-visitor SaaS pricing.

## Between events (idle)

Serverless components scale to **near-zero** when no visitors are polling:

| Service | Idle cost |
|---------|-----------|
| Lambda | $0 (no invocations) |
| API Gateway | $0 (no requests) |
| DynamoDB | Pennies — on-demand storage for visitor records (TTL expires rows) |
| CloudFront | $0 request cost; minimal S3 storage for static assets |
| EventBridge + reaper | Fractions of a cent per minute schedule |

Expect **a few dollars per month or less** for an idle stack excluding fixed add-ons (WAF Web ACL, Secrets Manager secrets, Route 53 hosted zone). No always-on EC2.

## Not included in the CLI estimate

Add these when budgeting a production `full` deployment:

- **WAF** — Web ACL hourly charge + per-request inspection
- **Data transfer** — cross-AZ, internet egress (usually small vs request charges)
- **CloudWatch** — logs and metrics (enable retention limits)
- **Secrets Manager** — JWT signing secret (~$0.40/secret/month)
- **Route 53** — hosted zone + queries
- **ACM** — TLS certificates are free for CloudFront/API use
- **Cognito** — admin portal MAU pricing (`full` preset)

## Compare to managed waiting room services

| | Self-host (this stack) | Managed waiting room (SaaS) |
|---|------------------------|---------------------------|
| Pricing model | AWS usage (requests, storage) | Per visitor, per event, or platform fee |
| 100K visitors × 1 hr (illustrative) | **~$100–200** CLI worst case; often less with adaptive poll + CDN | Often **$thousands+** at published per-visitor rates |
| Idle between events | ~$0 compute | May include platform minimum |
| Trade-off | Operator runs CDK + monitors AWS | Vendor operates infrastructure |

Exact managed-service pricing depends on vendor and contract — the point is serverless AWS economics for **occasional** flash events vs continuous platform fees.

## Workflow

1. **Before deploy** — run `npx vazue-queue cost` with expected peak visitors and worst-case wait time.
2. **Stress-test assumptions** — if average wait is 20 minutes but the CLI uses 60, scale down: `cost --visitors N --minutes 20`.
3. **After first event** — AWS Cost Explorer filtered by stack tags / service (API Gateway, Lambda, DynamoDB, CloudFront).
4. **Tune** — increase `poll_after_seconds` behavior is automatic; ensure `standard` preset for status caching on large events.

## Related

- [Capacity planning](/docs/guides/capacity) — concurrent poller limits and load tests
- [Presets](/docs/concepts/presets) — what each preset deploys
- [Deploy with CDK](/docs/guides/deploy) — bootstrap and deploy steps
