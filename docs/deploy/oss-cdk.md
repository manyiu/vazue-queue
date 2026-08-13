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
```

## Load test

```bash
# API must be running (local-server seeds event "demo")
bash scripts/load-test-100k.sh
# Report: ./load-test-report.json in the directory where you ran the command
```
