# OSS v1.0 launch checklist

Publish `@yiu/queue-cdk` **1.0.0** when this list is complete. SaaS (`packages/saas/`) is **not** part of v1.

**npm scope:** v1 publishes under **`@yiu/*`** (npm user `yiu`). When the `@vazue` npm org exists, publish parallel `@vazue/*` packages and deprecate `@yiu/*` — npm does not rename scopes on transfer.

## Quality

- [x] `pnpm verify` green on `main` (keep green)
- [x] `REQUIRE_ARTIFACTS=1 bash scripts/build-lambda-assets.sh` (zig + cargo-lambda)
- [x] CDK synth: `pnpm --filter @yiu/queue-cdk test`
- [x] Load test RC: `PROFILE=rc bash scripts/load-test-100k.sh` against a **deployed** data plane
  - Thresholds: fail rate &lt; 1%, p95 &lt; 250ms, p99 &lt; 500ms
  - 100K concurrent pollers: `PROFILE=rc VUS=100000` on distributed k6 / AWS DLTS — attach `load-test-report.json`
  - Runbook: `docs/deploy/oss-cdk.md` (Load test)
  - In-region pass (CodeBuild us-east-1, 1000 VUs, p95 ~34ms): [`load-test-rc-2026-08-22-inregion.md`](./load-test-rc-2026-08-22-inregion.md) / [`.json`](./load-test-rc-2026-08-22-inregion.json)
  - Earlier HKT-client miss (geography): [`load-test-rc-2026-08-21.md`](./load-test-rc-2026-08-21.md) / [`.json`](./load-test-rc-2026-08-21.json)

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

`packages/saas/` and connector/frontend apps stay private. Release workflow publishes with **npm provenance** (`.github/workflows/release.yml`).

- [ ] Changeset bump to **1.0.0** + merge release PR when quality gates above pass
- [ ] Confirm npm provenance attestations on the three packages

## Docs / community

- [x] `docs/deploy/oss-cdk.md` current
- [x] Landing source: `apps/landing` (point `queue.vazue.com` DNS when ready)
- [x] `SECURITY.md` reporting + scope
- [ ] Enable GitHub Discussions on the public repo (Settings → General → Features)
- [ ] Deploy landing to Pages / CloudFront and cut over `queue.vazue.com`

## Honest integration note

v1 is a **safety net / fair line** with app-side token validation (`verifyAdmitToken`).
Unskippable origin protection is the CloudFront Lambda@Edge connector — see
`examples/with-existing-cloudfront` and `docs/deploy/oss-cdk.md` (Lambda@Edge origin gate).
