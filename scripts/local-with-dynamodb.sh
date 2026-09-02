#!/usr/bin/env bash
# Start DynamoDB Local, bootstrap tables, run local-server against DynamoDbStore.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose -f docker-compose.local.yml up -d
bash scripts/bootstrap-dynamodb-local.sh

export VAZUE_USE_DYNAMODB=1
exec cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
