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
grep -q '/v1/events/{eventId}/export' openapi/vazue-queue.yaml
grep -q '/v1/rooms/{roomId}' openapi/vazue-queue.yaml

echo "==> Go / Java SDKs"
# Policy: native toolchains in GitHub Actions; Docker only as a local laptop helper.
run_go_tests() {
  (cd packages/sdk-go && go test -count=1 ./...)
}
run_java_tests() {
  (cd packages/sdk-java && mvn -q -B test)
}

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  command -v go >/dev/null 2>&1 || {
    echo "ERROR: go required in CI (use actions/setup-go); Docker fallback is local-only"
    exit 1
  }
  command -v mvn >/dev/null 2>&1 || {
    echo "ERROR: mvn required in CI (use actions/setup-java); Docker fallback is local-only"
    exit 1
  }
  run_go_tests
  run_java_tests
else
  if command -v go >/dev/null 2>&1; then
    run_go_tests
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    bash scripts/sdk-go-test.sh
  else
    echo "skip Go SDK: install go, or start Docker and use scripts/sdk-go-test.sh"
  fi
  if command -v mvn >/dev/null 2>&1; then
    run_java_tests
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    bash scripts/sdk-java-test.sh
  else
    echo "skip Java SDK: install Maven/JDK 11+, or start Docker and use scripts/sdk-java-test.sh"
  fi
fi

echo "==> pnpm package tests"
pnpm --filter @vazue/queue-cdk test
pnpm --filter @vazue/queue-sdk test
pnpm --filter create-vazue-queue test
pnpm --filter @vazue/saas-plan-limits test
pnpm --filter @vazue/saas-billing test
pnpm --filter @vazue/saas-cdk test
pnpm --filter @vazue/queue-edge-cloudfront test

echo "verify OK"
