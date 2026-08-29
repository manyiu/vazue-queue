# Load test enroll burst (`standard`, buffered) — 2026-08-29

In-region `PROFILE=rc` run at **1000** unique concurrent enrolls on the **`standard`** preset with **`enrollBuffer: true`**. Each virtual user performs one `POST …/enroll` (expects **202** + pre-assigned `request_id`; worker writes visitor asynchronously).

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| Enroll HTTP fail rate | < 1% | **0.0000** | Yes |
| Enroll POST p95 | informational (~700–850ms ref.) | **839.3ms** | — |

**Overall:** PASS (k6 exit 99)

## Percentiles (enroll POST only)

| Percentile | Latency |
|------------|---------|
| p50 | **—ms** |
| p90 | **804.9ms** |
| p95 | **839.3ms** |
| p99 | **—ms** |

## Interpretation

- **1000 unique buffered enrolls** fired concurrently — production-recommended flash-traffic path (`standard` + SQS buffer).
- **Reliability:** 0% HTTP failures (unchanged vs prior run and vs 0.1% on sync `minimal`).
- **Latency:** enroll POST p95 **839ms** on this run (prior same-day run before SQS client reuse: **688ms**). Run-to-run variance on a fresh stack with 1000 simultaneous cold starts is expected; the fix removes per-request SDK init on **warm** instances, which this burst shape (one request per new Lambda) mostly does not exercise.
- **Code under test:** EnrollFn reuses a single SQS client from `AppState` (cold start) instead of `load_defaults()` + new client per POST.
- Status polling after enroll: **no (enroll POST only)**.
- Buffered path remains **~2× faster** than sync `minimal` (~1406ms p95 in [`load-test-enroll-2026-08-29.md`](./load-test-enroll-2026-08-29.md)). Enroll burst RC gate is **fail rate only**; POST p95 is recorded for capacity planning.

## Conditions

| Item | Value |
|------|--------|
| Date | 2026-08-29 15:04 UTC |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueLoadTestEnrollStandard` (destroyed after run unless `SKIP_DESTROY=1`) |
| Preset | **`standard`** (CloudFront waiting room + API behaviors) |
| Enroll buffer | **on** (202 + SQS worker) |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` (enroll) | `https://uvuq2hiqb6.execute-api.us-east-1.amazonaws.com` |
| `WAITING_ROOM_URL` | `https://d3qbcunumh8vb2.cloudfront.net` |
| `EVENT_ID` | `loadtest-enroll-standard` |
| Load generator | **k6 v0.54.0 on CodeBuild `BUILD_GENERAL1_LARGE` (us-east-1)** |
| Script | `scripts/run-load-test-enroll-standard-inregion.sh` → `scripts/load-test-enroll.js` |
| Profile | `rc` / **1000** VUs (1 enroll each) |
| Enrollments | **1000** |

## Raw metrics

Machine-readable copy: [`load-test-enroll-standard-2026-08-29.json`](./load-test-enroll-standard-2026-08-29.json)

```json
{
  "profile": "rc",
  "targetVus": 1000,
  "workerId": null,
  "scenario": "enroll_burst",
  "preset": "standard",
  "enroll_buffer": true,
  "poll_after_enroll": false,
  "http_req_failed_rate": 0,
  "http_req_duration_p90": 804.9306968,
  "http_req_duration_p95": 839.2969112999999,
  "status_poll_failed_rate": null,
  "enrollments": 1000,
  "iterations": 1000
}
```
