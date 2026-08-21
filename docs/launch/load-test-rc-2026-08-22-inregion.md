# Load test RC record — 2026-08-22 (in-region)

Successful **in-region** `PROFILE=rc` run for OSS v1.0 after the HKT client attempt missed p95 due to geography ([prior record](./load-test-rc-2026-08-21.md)).

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| HTTP fail rate | &lt; 1% | **0%** | Yes |
| `http_req_duration` p95 | &lt; 250ms | **33.8ms** | Yes |
| `http_req_duration` p99 | &lt; 500ms | *(not in summary JSON)* | — (k6 exit 0; thresholds include p99) |

CodeBuild build **SUCCEEDED**; k6 exit code **0**.

## Conditions

| Item | Value |
|------|--------|
| Date | 2026-08-22 ~01:30–01:52 **HKT** (build ran in **us-east-1**) |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueLoadTestRc` (destroyed after the run) |
| Preset | **`minimal`** (API Gateway → Lambda → DynamoDB; no CloudFront) |
| Enroll buffer | **off** |
| Lambda memory | **512 MB** |
| Architecture | arm64 Lambda zips |
| Bot protection | off |
| `QUEUE_API_URL` | `https://yxbwm6sew3.execute-api.us-east-1.amazonaws.com` |
| `EVENT_ID` | `loadtest-rc` (DynamoDB-seeded) |
| Load generator | **k6 v0.54.0 in AWS CodeBuild** (`BUILD_GENERAL1_LARGE`, amazonlinux2) — same region as API |
| Script | `scripts/load-test-status.js` via `scripts/run-load-test-rc-inregion.sh` |
| Profile | `rc` / **1000** VUs |
| Stages | 2m → 500, 5m → 1000, 2m → 0 |
| Quiet mode | `k6 run --quiet` (avoids CodeBuild log-volume failure seen on verbose progress) |
| Iterations | **155,864** |
| Post-run | Stack, CodeBuild project, IAM role, and S3 bucket removed |

## Raw metrics

Machine-readable copy: [`load-test-rc-2026-08-22-inregion.json`](./load-test-rc-2026-08-22-inregion.json)

```json
{
  "profile": "rc",
  "targetVus": 1000,
  "http_req_failed_rate": 0,
  "http_req_duration_p95": 33.809650999999995,
  "iterations": 155864
}
```

## Interpretation

- Same scenario as the HKT run (shared `request_id` status polls), but generator RTT is in-region.
- p95 dropped from **~286ms (HKT)** to **~34ms (us-east-1)** — confirms the earlier miss was primarily **client geography**, not data-plane capacity at 1000 VUs.
- Full **100K** concurrent pollers still needs distributed k6 / AWS DLTS (`VUS=100000`).

## Checklist

OSS v1 load-test RC gate for 1000 VUs / documented thresholds: **met** (see [`oss-v1.md`](./oss-v1.md)).
