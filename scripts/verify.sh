#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> publish boundary"
bash scripts/check-publish-boundary.sh

echo "==> cargo fmt --check"
(cd packages/core-rust && cargo fmt --all -- --check)

echo "==> cargo clippy"
(cd packages/core-rust && cargo clippy --workspace -- -D warnings)

echo "==> cargo test"
(cd packages/core-rust && cargo test --workspace)
echo "==> pnpm package tests"
pnpm --filter @vazue/queue-cdk test
pnpm --filter @vazue/queue-sdk test
pnpm --filter @vazue/saas-plan-limits test
pnpm --filter @vazue/queue-edge-cloudfront test

echo "verify OK"
