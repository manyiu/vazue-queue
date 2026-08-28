#!/usr/bin/env bash
# Ephemeral `standard` preset deploy smoke in us-east-1 (API Gateway + CloudFront waiting room).
# Builds monorepo artifacts, deploys, seeds an event, runs contract smoke, destroys stack.
#
# Usage:
#   bash scripts/deploy-smoke-standard.sh
#   SKIP_DESTROY=1 bash scripts/deploy-smoke-standard.sh   # leave stack up for inspection
#   SKIP_DEPLOY=1 bash scripts/deploy-smoke-standard.sh    # smoke an existing stack
set -euo pipefail

unproxy() { env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy "$@"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_NAME=VazueQueueDeploySmokeStandard
REGION=us-east-1
EVENT_ID=deploy-smoke
RETURN_URL=https://example.com/checkout
# Avoid hung smoke runs on stalled HTTP connections.
CURL_OPTS=(--connect-timeout 10 --max-time 30)

cleanup() {
  if [[ "${SKIP_DESTROY:-}" == "1" ]]; then
    echo "==> SKIP_DESTROY=1 — stack left up ($STACK_NAME)"
    return
  fi
  set +e
  echo "==> destroy stack"
  (cd "$ROOT/examples/deploy-smoke-standard" && unproxy npx cdk destroy "$STACK_NAME" --force)
  echo "==> destroy done"
}
trap cleanup EXIT

echo "==> AWS credentials"
eval "$(unproxy aws configure export-credentials --format env)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_REGION="$REGION"
ACCOUNT=$(unproxy aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT="$ACCOUNT"
echo "account=$ACCOUNT region=$REGION"

if [[ "${SKIP_DEPLOY:-}" != "1" ]]; then
  echo "==> pnpm install"
  (cd "$ROOT" && pnpm install --frozen-lockfile)

  if [[ "${SKIP_BUILD:-}" != "1" ]]; then
    echo "==> build lambda artifacts"
    REQUIRE_ARTIFACTS=1 bash "$ROOT/scripts/build-lambda-assets.sh"

    echo "==> build waiting room"
    bash "$ROOT/scripts/build-waiting-room.sh"
  else
    echo "==> SKIP_BUILD=1"
  fi

  echo "==> build @yiu/queue-cdk (deploy uses dist/)"
  pnpm --filter @yiu/queue-cdk build

  echo "==> deploy stack ($STACK_NAME)"
  (cd "$ROOT/examples/deploy-smoke-standard" && unproxy npx cdk deploy "$STACK_NAME" --require-approval never)
fi

QUEUE_API_URL=$(unproxy aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?contains(OutputKey,'QueueApiUrl')].OutputValue" --output text)
WAITING_ROOM_URL=$(unproxy aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?contains(OutputKey,'WaitingRoomUrl')].OutputValue" --output text)
EVENTS_TABLE=$(unproxy aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && contains(LogicalResourceId,'Events')].PhysicalResourceId" \
  --output text)

echo "QUEUE_API_URL=$QUEUE_API_URL"
echo "WAITING_ROOM_URL=$WAITING_ROOM_URL"
echo "EVENTS_TABLE=$EVENTS_TABLE"

[[ -n "$QUEUE_API_URL" && -n "$WAITING_ROOM_URL" && -n "$EVENTS_TABLE" ]] || {
  echo "ERROR: missing stack outputs"
  exit 1
}

echo "==> seed event $EVENT_ID"
unproxy aws dynamodb put-item --table-name "$EVENTS_TABLE" --item "{
  \"tenantId\":{\"S\":\"default\"},
  \"eventId\":{\"S\":\"$EVENT_ID\"},
  \"roomId\":{\"S\":\"default\"},
  \"throughputPerMinute\":{\"N\":\"60000\"},
  \"paused\":{\"BOOL\":false},
  \"emergencyOpen\":{\"BOOL\":false},
  \"inviteOnly\":{\"BOOL\":false},
  \"dressRehearsal\":{\"BOOL\":false},
  \"botProtection\":{\"S\":\"off\"},
  \"returnUrl\":{\"S\":\"$RETURN_URL\"}
}"

poll_status() {
  local base=$1
  local rid=$2
  local code
  for _ in $(seq 1 90); do
    code=$(curl -sS "${CURL_OPTS[@]}" -o /tmp/vazue-smoke-status.json -w '%{http_code}' \
      "$base/v1/events/$EVENT_ID/status?request_id=$rid" || true)
    if [[ "$code" == "200" ]]; then
      cat /tmp/vazue-smoke-status.json
      return 0
    fi
    sleep 1
  done
  echo "ERROR: status never returned 200 from $base (last code=$code)" >&2
  [[ -f /tmp/vazue-smoke-status.json ]] && cat /tmp/vazue-smoke-status.json >&2 || true
  return 1
}

enroll_and_status() {
  local label=$1
  local base=$2
  local check_health=${3:-1}
  echo "==> smoke $label ($base)"
  if [[ "$check_health" == "1" ]]; then
    curl -sf "${CURL_OPTS[@]}" "$base/health" >/dev/null
    curl -sf "${CURL_OPTS[@]}" "$base/ready" >/dev/null
  fi
  local enroll
  enroll=$(curl -sS "${CURL_OPTS[@]}" -X POST "$base/v1/events/$EVENT_ID/enroll" \
    -H 'Content-Type: application/json' \
    -d "{\"return_url\":\"$RETURN_URL\"}")
  local rid
  rid=$(printf '%s' "$enroll" | python3 -c 'import sys,json; print(json.load(sys.stdin)["request_id"])')
  echo "enroll request_id=$rid"
  local status
  status=$(poll_status "$base" "$rid")
  printf '%s' "$status" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("return_url")==sys.argv[1], d' "$RETURN_URL"
  echo "$label OK"
}

echo "==> waiting room static asset (poll until CloudFront serves HTML)"
for i in $(seq 1 60); do
  code=$(curl -sS "${CURL_OPTS[@]}" -o /tmp/vazue-wr.html -w '%{http_code}' "$WAITING_ROOM_URL/" || true)
  if [[ "$code" == "200" ]] && grep -qi 'html' /tmp/vazue-wr.html; then
    echo "waiting room ready (attempt $i)"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: waiting room not ready (last HTTP $code)" >&2
    head -c 500 /tmp/vazue-wr.html >&2 || true
    exit 1
  fi
  sleep 10
done

enroll_and_status "api-gateway" "$QUEUE_API_URL" 1
enroll_and_status "cloudfront" "$WAITING_ROOM_URL" 0

REPORT_DATE=$(date -u +%Y-%m-%d)
REPORT_MD="$ROOT/docs/launch/deploy-smoke-standard-${REPORT_DATE}.md"
REPORT_JSON="$ROOT/docs/launch/deploy-smoke-standard-${REPORT_DATE}.json"

mkdir -p "$ROOT/docs/launch"
cat >"$REPORT_MD" <<EOF
# Deploy smoke — standard preset (${REPORT_DATE})

Ephemeral **\`standard\`** preset deploy smoke in **us-east-1** (destroyed after the run unless \`SKIP_DESTROY=1\`).

## Verdict

| Check | Result |
|-------|--------|
| Lambda artifacts built | yes |
| Waiting room assets deployed | yes |
| \`GET /health\` + \`GET /ready\` | pass |
| Enroll → status (API Gateway) | pass |
| Enroll → status (CloudFront) | pass |
| Waiting room HTML | pass |
| \`return_url\` on status | pass |

## Conditions

| Item | Value |
|------|--------|
| Date | ${REPORT_DATE} (UTC) |
| AWS account | \`${ACCOUNT}\` |
| Region | **us-east-1** |
| Stack | \`${STACK_NAME}\` |
| Preset | **standard** (CloudFront waiting room + API behaviors) |
| \`QUEUE_API_URL\` | \`${QUEUE_API_URL}\` |
| \`WAITING_ROOM_URL\` | \`${WAITING_ROOM_URL}\` |
| \`EVENT_ID\` | \`${EVENT_ID}\` (DynamoDB-seeded) |
| Script | \`scripts/deploy-smoke-standard.sh\` |

## Checklist

OSS v1 \`standard\` preset deploy smoke gate: **met** (see [\`CONTRIBUTING.md\`](../../CONTRIBUTING.md)).
EOF

python3 - <<PY
import json, os
doc = {
  "record": os.path.relpath("$REPORT_MD", "$ROOT"),
  "date": "$REPORT_DATE",
  "account": "$ACCOUNT",
  "region": "$REGION",
  "stack": "$STACK_NAME",
  "preset": "standard",
  "queueApiUrl": "$QUEUE_API_URL",
  "waitingRoomUrl": "$WAITING_ROOM_URL",
  "eventId": "$EVENT_ID",
  "verdict": "pass",
}
open("$REPORT_JSON", "w").write(json.dumps(doc, indent=2) + "\\n")
print("wrote", "$REPORT_JSON")
PY

echo "==== REPORT ===="
cat "$REPORT_MD"
echo "deploy smoke standard OK"
