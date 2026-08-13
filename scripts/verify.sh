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

echo "==> openapi smoke"
test -f openapi/vazue-queue.yaml
grep -q '^openapi:' openapi/vazue-queue.yaml
grep -q '/v1/events/{eventId}/enroll' openapi/vazue-queue.yaml
grep -q '/v1/events/{eventId}/status' openapi/vazue-queue.yaml
grep -q '/ready' openapi/vazue-queue.yaml
grep -q 'return_url' openapi/vazue-queue.yaml

echo "==> pnpm package tests"
pnpm --filter @vazue/queue-cdk test
pnpm --filter @vazue/queue-sdk test
pnpm --filter create-vazue-queue test
pnpm --filter @vazue/saas-plan-limits test
pnpm --filter @vazue/saas-billing test
pnpm --filter @vazue/saas-cdk test
pnpm --filter @vazue/queue-edge-cloudfront test

echo "verify OK"
