#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> unit (cargo + vitest subset)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/packages/core-rust/target}"
cargo test --manifest-path packages/core-rust/Cargo.toml --workspace
pnpm --filter @yiu/queue-cdk test
pnpm --filter @yiu/queue-sdk test
pnpm --filter create-vazue-queue test
pnpm --filter @vazue/saas-plan-limits test
pnpm --filter @vazue/queue-edge-cloudfront test

echo "==> openapi present"
test -f openapi/vazue-queue.yaml

echo "==> local API smoke (spawn local-server)"
cargo build --manifest-path packages/core-rust/Cargo.toml -p queue-api --bin local-server
LOCAL_BIN="$CARGO_TARGET_DIR/debug/local-server"
if [[ ! -x "$LOCAL_BIN" ]]; then
  LOCAL_BIN="$ROOT/packages/core-rust/target/debug/local-server"
fi
"$LOCAL_BIN" &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
bash scripts/test-api.sh
bash scripts/sdk-smoke.sh

echo "test:local OK"
