#!/usr/bin/env bash
# Optional smoke: DynamoDB Local + local-server (DynamoDbStore path).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "skip DynamoDB Local smoke: Docker required" >&2
  exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI required for bootstrap-dynamodb-local.sh" >&2
  exit 1
fi

docker compose -f docker-compose.local.yml up -d
bash scripts/bootstrap-dynamodb-local.sh

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/packages/core-rust/target}"
cargo build --manifest-path packages/core-rust/Cargo.toml -p queue-api --bin local-server
LOCAL_BIN="$CARGO_TARGET_DIR/debug/local-server"
if [[ ! -x "$LOCAL_BIN" ]]; then
  LOCAL_BIN="$ROOT/packages/core-rust/target/debug/local-server"
fi

export VAZUE_USE_DYNAMODB=1
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
echo "test-dynamodb-local OK"
