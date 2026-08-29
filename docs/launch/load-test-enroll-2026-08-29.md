# Load test enroll burst — 2026-08-29

In-region `PROFILE=rc` run at **1000** unique concurrent enrolls on the **`minimal`** preset (`enrollBuffer: false`). Each virtual user performs one `POST …/enroll` with a unique `session_id`.

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| Enroll HTTP fail rate | < 1% | **0.0010** | Yes |
| Enroll `http_req_duration` p95 | < 500ms | **1406.1ms** | No |
| Enroll `http_req_duration` p99 | < 1000ms | **—ms** | No |

**Overall:** FAIL (k6 exit 99)

## Percentiles (enroll only)

| Percentile | Latency |
|------------|---------|
| p50 | **—ms** |
| p90 | **1272.2ms** |
| p95 | **1406.1ms** |
| p99 | **—ms** |

## Interpretation

- **1000 unique enrolls** fired concurrently (one per VU) — flash-traffic shape at on-sale.
- **Reliability held:** 0.1% HTTP failures (1 of 1000) — within the &lt; 1% gate.
- **Latency missed gate:** enroll p95 ~1.4s vs 500ms threshold. Enroll does DynamoDB counter increments + visitor `PutItem` per request; 1000 simultaneous writes contend on shard counters and Lambda concurrency.
- Status polling after enroll: **no (enroll only)**.
- For production flash traffic, prefer **`standard`/`full` preset with `enrollBuffer: true`** (202 + async worker) to absorb spikes; this test used synchronous enroll (`minimal`, buffer off).

## Conditions

| Item | Value |
|------|--------|
| Date | 2026-08-29 09:13 UTC |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueLoadTestEnroll` (destroyed after run unless `SKIP_DESTROY=1`) |
| Preset | **`minimal`** (synchronous enroll, no buffer) |
| Enroll buffer | **off** |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` | `https://08lljfshy9.execute-api.us-east-1.amazonaws.com` |
| `EVENT_ID` | `loadtest-enroll` |
| Load generator | **k6 v0.54.0 on CodeBuild `BUILD_GENERAL1_LARGE` (us-east-1)** |
| Script | `scripts/run-load-test-enroll-inregion.sh` → `scripts/load-test-enroll.js` |
| Profile | `rc` / **1000** VUs (1 enroll each) |
| Enrollments | **1000** |

## Raw metrics

Machine-readable copy: [`load-test-enroll-2026-08-29.json`](./load-test-enroll-2026-08-29.json)

```json
{
  "profile": "rc",
  "targetVus": 1000,
  "workerId": null,
  "scenario": "enroll_burst",
  "poll_after_enroll": false,
  "http_req_failed_rate": 0.001,
  "http_req_duration_p90": 1272.225888,
  "http_req_duration_p95": 1406.12863845,
  "status_poll_failed_rate": null,
  "enrollments": 1000,
  "iterations": 1000
}
```
