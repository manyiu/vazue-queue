# Load test enroll burst (`standard`, buffered) — 2026-08-29

In-region `PROFILE=rc` run at **1000** unique concurrent enrolls on the **`standard`** preset with **`enrollBuffer: true`**. Each virtual user performs one `POST …/enroll` (expects **202** + pre-assigned `request_id`; worker writes visitor asynchronously).

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| Enroll HTTP fail rate | < 1% | **0.0000** | Yes |
| Enroll `http_req_duration` p95 | < 500ms | **687.6ms** | No |
| Enroll `http_req_duration` p99 | < 1000ms | **—ms** | Yes |

**Overall:** FAIL (k6 exit 99)

## Percentiles (enroll POST only)

| Percentile | Latency |
|------------|---------|
| p50 | **—ms** |
| p90 | **661.6ms** |
| p95 | **687.6ms** |
| p99 | **—ms** |

## Interpretation

- **1000 unique buffered enrolls** fired concurrently — production-recommended flash-traffic path (`standard` + SQS buffer).
- **Reliability:** 0% HTTP failures (vs 0.1% on sync `minimal`).
- **Latency:** enroll POST p95 ~688ms — **~2× faster** than sync `minimal` (~1406ms) but still above the 500ms gate (SQS send + Lambda under 1K concurrent burst).
- Status polling after enroll: **no (enroll POST only)**.
- For on-sale events, prefer this path over synchronous enroll; visitors get a `request_id` immediately (202) while the worker drains the queue.

## Conditions

| Item | Value |
|------|--------|
| Date | 2026-08-29 12:52 UTC |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueLoadTestEnrollStandard` (destroyed after run unless `SKIP_DESTROY=1`) |
| Preset | **`standard`** (CloudFront waiting room + API behaviors) |
| Enroll buffer | **on** (202 + SQS worker) |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` (enroll) | `https://s2wy1m0ekl.execute-api.us-east-1.amazonaws.com` |
| `WAITING_ROOM_URL` | `https://d1hnfvu4a8b9ni.cloudfront.net` |
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
  "http_req_duration_p90": 661.6461965999999,
  "http_req_duration_p95": 687.6357552000001,
  "status_poll_failed_rate": null,
  "enrollments": 1000,
  "iterations": 1000
}
```
