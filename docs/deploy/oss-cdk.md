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

Without Lambda zips, CDK still synthesizes using Node 501 placeholders so tests pass; real deploys need the zips.

## Local dual API

```bash
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
# queue :3000  ·  admin :3001 (event creates sync into the queue store)
# Sets VAZUE_LOCAL=1 and ADMIN_DEV_AUTH=1 so admin Bearer checks are skipped.
```

Admin portal local: `NEXT_PUBLIC_ADMIN_DEV_AUTH=1` (and optional Cognito env vars). Deployed admin loads Cognito + API URLs from `/config.js` (`window.__VAZUE_ADMIN_CONFIG__`).

To exercise admin JWT presence checks locally: unset those flags and set `ADMIN_REQUIRE_JWT=1`.

## Lambda artifacts

`scripts/build-lambda-assets.sh` produces `packages/cdk/assets/lambda/*.zip`. On PR CI, missing zips are non-fatal (`REQUIRE_ARTIFACTS=0`); use workflow_dispatch on **Rust Lambda CI** with `require_artifacts=true` before a real deploy. Without zips, CDK synthesizes Node 501 placeholders.

## Load test

```bash
# API must be running (local-server seeds event "demo")
bash scripts/load-test-100k.sh
# Report: ./load-test-report.json in the directory where you ran the command
```
