#!/usr/bin/env bash
# Enroll + admit-token verify against local-server (queue :3000, admin :3001).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUEUE_API_URL="${QUEUE_API_URL:-http://127.0.0.1:3000}"
ADMIN_API_URL="${ADMIN_API_URL:-http://127.0.0.1:3001}"
EVENT=demo

wait_for() {
  local url="$1"
  local label="$2"
  for i in $(seq 1 30); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo "sdk-smoke: $label not ready at $url (start local-server first)" >&2
  return 1
}

wait_for "$QUEUE_API_URL/health" "queue API"
wait_for "$ADMIN_API_URL/health" "admin API"

curl -sf -X PUT "$ADMIN_API_URL/v1/events/$EVENT" \
  -H 'content-type: application/json' \
  -d '{"emergency_open":true}' >/dev/null

cleanup() {
  curl -sf -X PUT "$ADMIN_API_URL/v1/events/$EVENT" \
    -H 'content-type: application/json' \
    -d '{"emergency_open":false}' >/dev/null 2>&1 || true
}
trap cleanup EXIT

export SDK_INTEGRATION=1
export QUEUE_API_URL ADMIN_API_URL

echo "==> TypeScript SDK integration"
pnpm --filter @yiu/queue-sdk exec vitest run test/local.integration.test.ts

if command -v go >/dev/null 2>&1; then
  echo "==> Go SDK integration"
  (cd packages/sdk-go && go test -tags=integration -count=1 ./...)
else
  echo "==> skip Go SDK integration (install go or use scripts/sdk-go-test.sh for unit tests)"
fi

if command -v mvn >/dev/null 2>&1; then
  echo "==> Java SDK integration"
  (cd packages/sdk-java && mvn -q -B test -Dtest=LocalIntegrationTest)
else
  echo "==> skip Java SDK integration (install Maven/JDK 11+ or use scripts/sdk-java-test.sh)"
fi

echo "sdk-smoke OK"
