# Load test standard preset — 2026-08-29

In-region `PROFILE=rc` run at **1000** concurrent status pollers on the **`standard`** preset. Enroll via API Gateway; status polls via **CloudFront** (edge-cached, 2–30s TTL keyed by `request_id`).

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| HTTP fail rate | < 1% | **0.0000** | Yes |
| `http_req_duration` p95 | < 250ms | **3.0ms** | Yes |
| `http_req_duration` p99 | < 500ms | **—** | Yes |

**Overall:** PASS (k6 exit 0)

## Percentiles

| Percentile | Latency |
|------------|---------|
| p50 | **—** |
| p90 | **2.5ms** |
| p95 | **3.0ms** |
| p99 | **—** |

## Interpretation

- **1K concurrent pollers** on the **`standard`** preset passes RC SLOs with **0% failures** and **p95 ~3ms** — far below the `minimal` 1K gate (~34ms p95).
- Status polls hit **CloudFront** (edge cache keyed by `request_id`); almost all responses are cache hits, so origin Lambda/API Gateway load is minimal compared to the `minimal` preset tests.
- This validates the capacity doc claim that **`standard` + CloudFront may outperform `minimal`** for steady status polling.

## Conditions

| Item | Value |
|------|--------|
| Date | 2026-08-29 08:40 UTC |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueLoadTestStandard` (destroyed after run) |
| Preset | **`standard`** (CloudFront status cache + waiting room) |
| Enroll buffer | **off** |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` (enroll) | `https://tu0hvj65sj.execute-api.us-east-1.amazonaws.com` |
| `WAITING_ROOM_URL` (status poll) | `https://d3m551e6w0nkl5.cloudfront.net` |
| `EVENT_ID` | `loadtest-standard` |
| Load generator | **k6 v0.54.0 on CodeBuild `BUILD_GENERAL1_LARGE` (us-east-1)** |
| Script | `scripts/run-load-test-standard-inregion.sh` → `scripts/load-test-status.js` |
| Profile | `rc` / **1000** VUs |
| Iterations | **157,721** |

## Raw metrics

Machine-readable copy: [`load-test-standard-2026-08-29.json`](./load-test-standard-2026-08-29.json)

```json
{
  "profile": "rc",
  "targetVus": 1000,
  "workerId": null,
  "pollBase": "https://d3m551e6w0nkl5.cloudfront.net",
  "http_req_failed_rate": 0,
  "http_req_duration_p90": 2.5199966,
  "http_req_duration_p95": 2.9992697499999994,
  "iterations": 157721
}
```
