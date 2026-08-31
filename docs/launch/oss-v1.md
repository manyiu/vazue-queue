# OSS v1.0 launch checklist

Publish `@yiu/queue-cdk` **1.0.0** when this list is complete.

**npm scope:** v1 publishes under **`@yiu/*`** (npm user `yiu`). When the `@vazue` npm org exists, publish parallel `@vazue/*` packages and deprecate `@yiu/*` — npm does not rename scopes on transfer.

**Maintenance releases (post-v1):** `@yiu/queue-cdk` **1.0.2** (lean EnrollFn init), **1.0.3** (jsonwebtoken 10 + Turnstile Secrets Manager loading). Redeploy stacks to pick up Lambda binary updates.

## Quality

- [x] `pnpm verify` green on `main` (keep green)
- [x] `REQUIRE_ARTIFACTS=1 bash scripts/build-lambda-assets.sh` (zig + cargo-lambda)
- [x] CDK synth: `pnpm --filter @yiu/queue-cdk test`
- [x] Load test RC: `PROFILE=rc` against a **deployed** data plane (**1000 VUs** — OSS v1 gate)
  - Thresholds: fail rate &lt; 1%, p95 &lt; 250ms, p99 &lt; 500ms
  - Runbook: `docs/deploy/oss-cdk.md` (Load test)
  - In-region pass (CodeBuild us-east-1, 1000 VUs, p95 ~34ms): [`load-test-rc-2026-08-22-inregion.md`](./load-test-rc-2026-08-22-inregion.md) / [`.json`](./load-test-rc-2026-08-22-inregion.json)
  - In-region pass (10,000 VUs, fail ~0.03%, p95 ~39ms): [`load-test-10k-2026-08-28.md`](./load-test-10k-2026-08-28.md) / [`.json`](./load-test-10k-2026-08-28.json)
  - Earlier HKT-client miss (geography): [`load-test-rc-2026-08-21.md`](./load-test-rc-2026-08-21.md) / [`.json`](./load-test-rc-2026-08-21.json)
  - **100K concurrent pollers — waived for v1** (exploratory; ~71% throttle failures under 10 parallel workers): [`load-test-100k-2026-08-28.md`](./load-test-100k-2026-08-28.md)

## Product

- [x] `npx create-vazue-queue` wizard / `--yes` writes `vazue-queue.config.json` (see scaffold tests)
- [x] Waiting room enroll → status → admit + `return_url`
- [x] Admin portal (`full` preset): pause, throttle, floodgates, dress rehearsal, CSV export
- [x] `GET /health` and `GET /ready` on both planes
- [x] Cost estimate: `npx vazue-queue cost --visitors 100000 --minutes 60`

## Publish (npm)

Only these packages (enforced by `scripts/check-publish-boundary.sh`):

- `@yiu/queue-cdk`
- `create-vazue-queue`
- `@yiu/queue-sdk`

Connector/frontend apps stay private. Release workflow publishes with **npm provenance** (`.github/workflows/release.yml`).

- [x] Changeset bump to **1.0.0** + publish (`@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk`)
- [x] Confirm npm provenance attestations on the three packages (`1.0.1` via OIDC Release workflow)

## Docs / community

- [x] `docs/deploy/oss-cdk.md` current
- [x] Landing source: `apps/landing` (point `queue.vazue.com` DNS when ready)
- [x] `SECURITY.md` reporting + scope
- [x] Enable GitHub Discussions on the public repo (Settings → General → Features)
- [x] Deploy landing via CDK (`pnpm --filter @vazue/landing-cdk run deploy`) and cut over `queue.vazue.com`

## Honest integration note

v1 is a **safety net / fair line** with app-side token validation (`verifyAdmitToken`).
Unskippable origin protection is the CloudFront Lambda@Edge connector — see
`examples/with-existing-cloudfront` and `docs/deploy/oss-cdk.md` (Lambda@Edge origin gate).
