#!/usr/bin/env bash
# Create DynamoDB Local tables (CDK schema) and seed the default demo event.
# Requires: docker compose -f docker-compose.local.yml up -d
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENDPOINT="${DYNAMODB_ENDPOINT:-http://127.0.0.1:8000}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-local}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-local}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

aws_cli() {
  aws dynamodb "$@" --endpoint-url "$ENDPOINT" --region "$AWS_DEFAULT_REGION"
}

wait_ready() {
  for i in $(seq 1 30); do
    if aws_cli list-tables >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "ERROR: DynamoDB Local not reachable at $ENDPOINT (run docker compose -f docker-compose.local.yml up -d)" >&2
  exit 1
}

create_table_if_missing() {
  local name="$1"
  shift
  if aws_cli describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "table exists: $name"
    return 0
  fi
  echo "creating table: $name"
  aws_cli create-table --table-name "$name" "$@"
}

echo "==> DynamoDB Local bootstrap ($ENDPOINT)"
wait_ready

create_table_if_missing Rooms \
  --attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=roomId,AttributeType=S \
  --key-schema AttributeName=tenantId,KeyType=HASH AttributeName=roomId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

create_table_if_missing Events \
  --attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=eventId,AttributeType=S \
  --key-schema AttributeName=tenantId,KeyType=HASH AttributeName=eventId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

create_table_if_missing Counters \
  --attribute-definitions AttributeName=eventId,AttributeType=S AttributeName=counterType,AttributeType=S \
  --key-schema AttributeName=eventId,KeyType=HASH AttributeName=counterType,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

create_table_if_missing Visitors \
  --attribute-definitions \
    AttributeName=eventId,AttributeType=S \
    AttributeName=requestId,AttributeType=S \
    AttributeName=sessionId,AttributeType=S \
  --key-schema AttributeName=eventId,KeyType=HASH AttributeName=requestId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes \
    'IndexName=bySession,KeySchema=[{AttributeName=eventId,KeyType=HASH},{AttributeName=sessionId,KeyType=RANGE}],Projection={ProjectionType=ALL}'

echo "==> seed demo event (idempotent put-item)"
aws_cli put-item --table-name Events --item '{
  "tenantId":{"S":"default"},
  "eventId":{"S":"demo"},
  "roomId":{"S":"default"},
  "throughputPerMinute":{"N":"100"},
  "paused":{"BOOL":false},
  "emergencyOpen":{"BOOL":false},
  "dressRehearsal":{"BOOL":false},
  "botProtection":{"S":"off"},
  "returnUrl":{"S":"https://example.com/checkout"}
}'

aws_cli put-item --table-name Rooms --item '{
  "tenantId":{"S":"default"},
  "roomId":{"S":"default"},
  "name":{"S":"Default room"},
  "activeEventId":{"S":"demo"},
  "defaultThroughput":{"N":"100"},
  "counterShards":{"N":"8"},
  "tokenTtlSeconds":{"N":"3600"},
  "visitorTtlHours":{"N":"24"},
  "themeJson":{"S":"{\"brandName\":\"Vazue Queue\",\"message\":\"You are in line. Please keep this tab open.\"}"}
}'

echo "bootstrap-dynamodb-local OK"
