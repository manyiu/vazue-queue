# Deploy smoke — standard preset (2026-08-28)

Ephemeral **`standard`** preset deploy smoke in **us-east-1** (destroyed after the run unless `SKIP_DESTROY=1`).

## Verdict

| Check | Result |
|-------|--------|
| Lambda artifacts built | yes |
| Waiting room assets deployed | yes |
| `GET /health` + `GET /ready` | pass |
| Enroll → status (API Gateway) | pass |
| Enroll → status (CloudFront) | pass |
| Waiting room HTML | pass |
| `return_url` on status | pass |

## Conditions

| Item | Value |
|------|--------|
| Date | 2026-08-28 (UTC) |
| AWS account | `517206156255` |
| Region | **us-east-1** |
| Stack | `VazueQueueDeploySmokeStandard` |
| Preset | **standard** (CloudFront waiting room + API behaviors) |
| `QUEUE_API_URL` | `https://mkt14lh4c7.execute-api.us-east-1.amazonaws.com` |
| `WAITING_ROOM_URL` | `https://dn1vtdwwuvh3u.cloudfront.net` |
| `EVENT_ID` | `deploy-smoke` (DynamoDB-seeded) |
| Script | `scripts/deploy-smoke-standard.sh` |

## Checklist

OSS v1 `standard` preset deploy smoke gate: **met** (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md)).
