# Deploy OSS with CDK

```bash
npx create-vazue-queue my-queue   # interactive wizard
cd my-queue
pnpm install
npx cdk bootstrap
npm run deploy
```

Non-interactive:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

Reconfigure:

```bash
npx vazue-queue config
npx vazue-queue config --validate
```

Default AWS region for examples: **us-east-1**.

## Pre-built assets (from this monorepo)

Before publishing `@vazue/queue-cdk` or deploying the monorepo example:

```bash
# Rust Lambdas → packages/cdk/assets/lambda/*.zip
scripts/build-lambda-assets.sh
# Optional CI gate:
REQUIRE_ARTIFACTS=1 scripts/build-lambda-assets.sh

# Waiting room UI → apps/waiting-room/dist
scripts/build-waiting-room.sh

# Admin portal static export → apps/admin-portal/out
scripts/build-admin-portal.sh
```

Without Lambda zips, CDK still synthesizes using Node 501 placeholders so tests pass; real deploys need the zips. On macOS, install **zig** (`brew install zig`) before `scripts/build-lambda-assets.sh`.

## Cost estimate

Rough us-east-1 list-price estimate for one event (not a quote):

```bash
npx vazue-queue cost --visitors 100000 --minutes 60 --poll 5
```

Assumes every visitor enrolls once and polls status for the whole window. Adaptive polling plus CloudFront status cache lower real spend.

## Return URL

Pass `return_url` on enroll (or set it on the event). GET status returns it when the visitor is admitted; the waiting room redirects there and appends `vazue_token`. Preserve the original deep link — do not replace it with a generic homepage.

## Health

- `GET /health` — liveness (data plane and admin)
- `GET /ready` — readiness (`deployment`, `tenantId`); no auth

## Load test

```bash
# Local smoke (needs k6 + local-server on :3000)
PROFILE=smoke bash scripts/load-test-100k.sh
# RC gate against a deployed API
QUEUE_API_URL=https://api.example.com PROFILE=rc bash scripts/load-test-100k.sh
```

Report writes `load-test-report.json`. Full 100K concurrent pollers needs distributed k6 or AWS Distributed Load Testing (`VUS=100000`).

## Frontend assets for deploy

```bash
scripts/build-waiting-room.sh   # → apps/.../dist + packages/cdk/assets/waiting-room
scripts/build-admin-portal.sh   # → apps/.../out + packages/cdk/assets/admin-portal
scripts/build-edge-connector.sh # → packages/cdk/assets/edge-cloudfront (full preset)
```

## Lambda@Edge origin gate (`full` preset)

Lambda@Edge **cannot use environment variables**. CDK bakes `waitingRoomUrl` + `jwtHmacSecret` into `edge-config.js` beside the handler.

```json
{
  "domainName": "queue.example.com",
  "preset": "full",
  "origin": { "domainName": "shop.example.com" },
  "security": { "jwtHmacSecret": "replace-with-a-long-random-secret" }
}
```

That creates a third CloudFront distribution in front of `shop.example.com` with a **viewer-request** association: missing/invalid `vazue_token` → 302 to `https://queue.example.com?returnUrl=...`. Point the shop DNS at `ProtectedOriginUrl`.

Without `origin.domainName`, the function is still built; associate the version ARN yourself on an existing distribution (stack `env` must be `us-east-1` for true Lambda@Edge).

## Enroll buffer (SQS)

Presets default `enrollBuffer: true`. Enroll Lambda sets `ENROLL_VIA_SQS=1`, returns **202** with a pre-assigned `request_id`, and the worker writes the visitor. Clients poll GET status (404 → treat as still enrolling).

## Local dual API

```bash
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
# queue :3000  ·  admin :3001 (event creates sync into the queue store)
# Sets VAZUE_LOCAL=1 and ADMIN_DEV_AUTH=1 so admin Bearer checks are skipped.
```

Admin portal local: `NEXT_PUBLIC_ADMIN_DEV_AUTH=1` (and optional Cognito env vars). Deployed admin loads Cognito + API URLs from `/config.js` (`window.__VAZUE_ADMIN_CONFIG__`). First-event wizard, room theme, live throttle, and `GET /v1/events/{id}/export` CSV are on `:3001`.

To exercise admin JWT presence checks locally: unset those flags and set `ADMIN_REQUIRE_JWT=1`.

## Lambda artifacts

`scripts/build-lambda-assets.sh` produces `packages/cdk/assets/lambda/*.zip`. On PR CI, missing zips are non-fatal (`REQUIRE_ARTIFACTS=0`); use workflow_dispatch on **Rust Lambda CI** with `require_artifacts=true` before a real deploy. Without zips, CDK synthesizes Node 501 placeholders.
