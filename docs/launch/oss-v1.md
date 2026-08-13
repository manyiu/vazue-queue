# OSS v1.0 launch checklist

Publish `@vazue/queue-cdk` **1.0.0** when this list is complete. SaaS (`packages/saas/`) is **not** part of v1.

## Quality

- [ ] `pnpm verify` green
- [ ] `REQUIRE_ARTIFACTS=1 bash scripts/build-lambda-assets.sh` (zig + cargo-lambda)
- [ ] CDK synth: `pnpm --filter @vazue/queue-cdk test`
- [ ] Load test RC: `PROFILE=rc bash scripts/load-test-100k.sh` against a deployed data plane
  - Thresholds: fail rate &lt; 1%, p95 &lt; 250ms, p99 &lt; 500ms
  - 100K concurrent pollers: `PROFILE=rc VUS=100000` on distributed k6 / AWS DLTS — attach `load-test-report.json`

## Product

- [ ] `npx create-vazue-queue` wizard writes `vazue-queue.config.json`
- [ ] Waiting room enroll → status → admit + `return_url`
- [ ] Admin portal (`full` preset): pause, throttle, floodgates, dress rehearsal, CSV export
- [ ] `GET /health` and `GET /ready` on both planes
- [ ] Cost estimate: `npx vazue-queue cost --visitors 100000 --minutes 60`

## Publish (npm)

Only these packages:

- `@vazue/queue-cdk`
- `create-vazue-queue`
- `@vazue/queue-sdk`

`packages/saas/` stays `private: true`. CI runs `scripts/check-publish-boundary.sh`.

## Docs / community

- [ ] `docs/deploy/oss-cdk.md` current
- [ ] Landing: `queue.vazue.com` → GitHub + npm
- [ ] SECURITY.md + GitHub Discussions enabled

## Honest integration note

v1 is a **safety net / fair line** with app-side token validation. Unskippable origin protection is the CloudFront Lambda@Edge connector (v1.1 / Phase 4).
