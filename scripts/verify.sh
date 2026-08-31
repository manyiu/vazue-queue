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
grep -q 'tenantId' openapi/vazue-queue.yaml
if grep -q 'deployment:' openapi/vazue-queue.yaml; then
  echo "ERROR: openapi /ready must not document deployment profile" >&2
  exit 1
fi
if grep -q 'api.queue.vazue.com' openapi/vazue-queue.yaml; then
  echo "ERROR: openapi must not include SaaS management server" >&2
  exit 1
fi

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
  # Local: prefer Docker helpers so laptops need no Go/JDK install.
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    bash scripts/sdk-go-test.sh
    bash scripts/sdk-java-test.sh
  else
    if command -v go >/dev/null 2>&1; then
      run_go_tests
    else
      echo "skip Go SDK: start Docker (scripts/sdk-go-test.sh) or install go"
    fi
    if command -v mvn >/dev/null 2>&1; then
      run_java_tests
    else
      echo "skip Java SDK: start Docker (scripts/sdk-java-test.sh) or install Maven/JDK 11+"
    fi
  fi
fi

echo "==> website build"
pnpm website:build

echo "==> pnpm package tests"
pnpm --filter @yiu/queue-cdk test
pnpm --filter @yiu/queue-sdk test
pnpm --filter create-vazue-queue test
pnpm --filter @vazue/queue-edge-cloudfront test

echo "verify OK"
