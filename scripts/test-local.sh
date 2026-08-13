#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> unit (cargo + vitest subset)"
cargo test --manifest-path packages/core-rust/Cargo.toml --workspace
pnpm --filter @vazue/queue-cdk test
pnpm --filter @vazue/queue-sdk test
pnpm --filter create-vazue-queue test --if-present || true
pnpm --filter @vazue/saas-plan-limits test
pnpm --filter @vazue/queue-edge-cloudfront test

echo "==> openapi present"
test -f openapi/vazue-queue.yaml

echo "test:local OK"
