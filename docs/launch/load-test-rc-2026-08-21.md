# Load test RC record — 2026-08-21

Ephemeral deployed-data-plane run of `PROFILE=rc` for OSS v1.0.  
**Not a closed release gate** — p95 missed the documented threshold; root cause attributed primarily to **client geography** (see below). Keep for later docs / release notes.

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| HTTP fail rate | &lt; 1% | **0%** | Yes |
| `http_req_duration` p95 | &lt; 250ms | **285.8ms** | No |
| `http_req_duration` p99 | &lt; 500ms | *(not captured in summary JSON)* | — |

k6 exited non-zero because the p95 threshold was crossed. No functional errors (fail rate 0).

## Conditions

| Item | Value |
|------|--------|
| Date (local) | 2026-08-21 evening → 2026-08-22 ~00:10 **HKT (UTC+8)** |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueLoadTestRc` (destroyed after the run) |
| Preset | **`minimal`** (data plane only; no waiting-room CloudFront) |
| Enroll buffer | **off** (`features.enrollBuffer: false`) so enroll returned **201** with `request_id` |
| Lambda memory | 256 MB (status / enroll / admit / reaper) |
| Architecture | arm64 (cargo-lambda zips from `REQUIRE_ARTIFACTS=1` build) |
| Bot protection | off |
| `QUEUE_API_URL` | `https://rpbm93mazc.execute-api.us-east-1.amazonaws.com` |
| `EVENT_ID` | `loadtest-rc` (seeded via DynamoDB `put-item` on Events table) |
| Tenant | `default` |
| Load generator | **k6 v2.2.0 on developer Mac (Hong Kong)** — not in-region |
| Script | `scripts/load-test-100k.sh` → `scripts/load-test-status.js` |
| Profile | `rc` (default **1000** VUs) |
| Stages | 2m → 500 VUs, 5m → 1000 VUs, 2m → 0 |
| Scenario | One enroll in `setup()`, then all VUs poll **the same** `GET …/status?request_id=…` |
| Duration | ~9m wall clock |
| Iterations | **139,543** |
| Post-run | Stack destroyed; ephemeral `examples/load-test-rc` removed |

## Raw metrics (summary)

```json
{
  "profile": "rc",
  "targetVus": 1000,
  "http_req_failed_rate": 0,
  "http_req_duration_p95": 285.795,
  "iterations": 139543
}
```

(`p99` was `undefined` in the custom `handleSummary` output for this k6 version.)

## Interpretation

- Reliability path looked healthy: **0%** failed requests under 1000 concurrent status pollers.
- p95 was **~36ms over** the 250ms gate. That is consistent with **cross-Pacific RTT** from HKT to us-east-1 (often ~180–250ms alone), plus cold starts during the VU ramp, and **no CloudFront status cache** (`minimal` hits API Gateway → Lambda → DynamoDB on every poll).
- A same-setup retry from the same laptop was judged **unlikely** to clear p95; a fair RC should run k6 **in us-east-1** (EC2 / distributed k6 / AWS DLTS), optionally on **`standard`** (CloudFront short TTL on status).

## Follow-ups (optional, not done)

1. Re-run `PROFILE=rc` with k6 in **us-east-1**.
2. Prefer **`standard`** if measuring cached status-poll latency as visitors experience it.
3. Capture full k6 percentile table (p50/p90/p95/p99) in the report writer for future runs.
4. Full **100K** VUs still requires distributed k6 / AWS DLTS (`VUS=100000`).

## Checklist link

Superseded for the OSS v1 RC **pass** by the in-region run: [`load-test-rc-2026-08-22-inregion.md`](./load-test-rc-2026-08-22-inregion.md).  
This HKT-client attempt remains useful context for release notes (why p95 must be measured in-region).
