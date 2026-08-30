#!/usr/bin/env bash
# In-region PROFILE=rc load test on the `standard` preset (CloudFront-cached status polls).
#
# Enroll hits API Gateway directly; status polls use CloudFront (visitor-realistic path).
#
# Usage:
#   bash scripts/run-load-test-standard-inregion.sh
#   VUS=1000 bash scripts/run-load-test-standard-inregion.sh
#   SKIP_DESTROY=1 bash scripts/run-load-test-standard-inregion.sh
set -euo pipefail

unproxy() { env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy "$@"; }

create_ephemeral_bucket() {
  local bucket=$1
  local region=$2
  if [[ "$region" == "us-east-1" ]]; then
    unproxy aws s3api create-bucket --bucket "$bucket" --region "$region"
  else
    unproxy aws s3api create-bucket --bucket "$bucket" --region "$region" \
      --create-bucket-configuration "LocationConstraint=$region"
  fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_NAME=VazueQueueLoadTestStandard
REGION="${REGION:-us-east-1}"
EVENT_ID="${EVENT_ID:-loadtest-standard}"
VUS="${VUS:-1000}"
PROJECT="${PROJECT:-vazue-loadtest-standard}"
ROLE_NAME="${ROLE_NAME:-vazue-loadtest-standard-codebuild}"
BUILD_ID=""
QUEUE_API_URL=""
WAITING_ROOM_URL=""
BUCKET=""
CURL_OPTS=(--connect-timeout 10 --max-time 30)

cleanup() {
  if [[ "${SKIP_DESTROY:-}" == "1" ]]; then
    echo "==> SKIP_DESTROY=1 — stack and bucket left up"
    return
  fi
  set +e
  echo "==> CLEANUP"
  [[ -n "${BUILD_ID:-}" ]] && unproxy aws codebuild stop-build --id "$BUILD_ID" >/dev/null 2>&1
  unproxy aws codebuild delete-project --name "$PROJECT" >/dev/null 2>&1
  if [[ -n "${BUCKET:-}" ]]; then
    unproxy aws s3 rm "s3://$BUCKET" --recursive >/dev/null 2>&1
    unproxy aws s3api delete-bucket --bucket "$BUCKET" >/dev/null 2>&1
  fi
  unproxy aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess >/dev/null 2>&1
  unproxy aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name s3access >/dev/null 2>&1
  unproxy aws iam delete-role --role-name "$ROLE_NAME" >/dev/null 2>&1
  (cd "$ROOT/examples/load-test-standard" && unproxy npx cdk destroy "$STACK_NAME" --force)
  echo "==> CLEANUP done"
}
trap cleanup EXIT

echo "==> AWS credentials"
eval "$(unproxy aws configure export-credentials --format env)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
ACCOUNT=$(unproxy aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION="$REGION"
BUCKET="vazue-loadtest-standard-${ACCOUNT}-$(date +%s)"
echo "account=$ACCOUNT region=$REGION vus=$VUS"

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

  echo "==> build @yiu/queue-cdk"
  pnpm --filter @yiu/queue-cdk build

  echo "==> deploy stack ($STACK_NAME)"
  (cd "$ROOT/examples/load-test-standard" && unproxy npx cdk deploy "$STACK_NAME" --require-approval never)
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

echo "==> wait for CloudFront waiting room"
for i in $(seq 1 60); do
  code=$(curl -sS "${CURL_OPTS[@]}" -o /tmp/vazue-lt-standard-wr.html -w '%{http_code}' "$WAITING_ROOM_URL/" || true)
  if [[ "$code" == "200" ]] && grep -qi 'html' /tmp/vazue-lt-standard-wr.html; then
    echo "waiting room ready (attempt $i)"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: waiting room not ready (last HTTP $code)" >&2
    exit 1
  fi
  sleep 10
done

echo "==> seed event $EVENT_ID"
unproxy aws dynamodb put-item --table-name "$EVENTS_TABLE" --item "{
  \"tenantId\":{\"S\":\"default\"},
  \"eventId\":{\"S\":\"$EVENT_ID\"},
  \"roomId\":{\"S\":\"default\"},
  \"throughputPerMinute\":{\"N\":\"1000\"},
  \"paused\":{\"BOOL\":false},
  \"emergencyOpen\":{\"BOOL\":false},
  \"inviteOnly\":{\"BOOL\":false},
  \"dressRehearsal\":{\"BOOL\":false},
  \"botProtection\":{\"S\":\"off\"},
  \"returnUrl\":{\"S\":\"https://example.com/checkout\"}
}"

ENROLL=$(unproxy curl -sS -X POST "$QUEUE_API_URL/v1/events/$EVENT_ID/enroll" -H 'Content-Type: application/json' -d '{}')
RID=$(printf '%s' "$ENROLL" | python3 -c 'import sys,json; print(json.load(sys.stdin)["request_id"])')
for _ in $(seq 1 30); do
  unproxy curl -sf "${CURL_OPTS[@]}" "$WAITING_ROOM_URL/v1/events/$EVENT_ID/status?request_id=$RID" >/dev/null
done
echo "warmed request_id=$RID (via CloudFront)"

echo "==> S3 bucket $BUCKET"
create_ephemeral_bucket "$BUCKET" "$REGION" >/dev/null
unproxy aws s3 cp "$ROOT/scripts/load-test-status.js" "s3://$BUCKET/load-test-status.js"

echo "==> CodeBuild role"
cat >/tmp/vazue-standard-cb-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
unproxy aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file:///tmp/vazue-standard-cb-trust.json >/dev/null
unproxy aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
cat >/tmp/vazue-standard-cb-s3.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"]}]}
EOF
unproxy aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name s3access --policy-document file:///tmp/vazue-standard-cb-s3.json
sleep 12

QUEUE_API_URL="$QUEUE_API_URL" POLL_BASE_URL="$WAITING_ROOM_URL" BUCKET="$BUCKET" ACCOUNT="$ACCOUNT" \
  PROJECT="$PROJECT" ROLE_NAME="$ROLE_NAME" EVENT_ID="$EVENT_ID" VUS="$VUS" python3 <<'PY'
import json, os

buildspec = """version: 0.2
phases:
  install:
    commands:
      - curl -fsSL https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz | tar xz
      - sudo mv k6-v0.54.0-linux-amd64/k6 /usr/local/bin/k6
      - k6 version
  build:
    commands:
      - |
        set -uo pipefail
        aws s3 cp "s3://$BUCKET/load-test-status.js" ./load-test-status.js
        echo "enroll=$QUEUE_API_URL poll=$POLL_BASE_URL event=$EVENT_ID vus=$VUS"
        set +e
        QUEUE_API_URL="$QUEUE_API_URL" POLL_BASE_URL="$POLL_BASE_URL" EVENT_ID="$EVENT_ID" PROFILE=rc VUS="$VUS" \\
          k6 run --quiet --log-output=stderr ./load-test-status.js
        K6_EXIT=$?
        set -e
        echo "k6_exit=$K6_EXIT"
        test -f load-test-report.json
        cat load-test-report.json
        aws s3 cp load-test-report.json "s3://$BUCKET/load-test-report.json"
        echo "$K6_EXIT" > k6.exit
        aws s3 cp k6.exit "s3://$BUCKET/k6.exit"
        exit 0
"""
proj = {
  "name": os.environ["PROJECT"],
  "description": "Ephemeral in-region k6 RC load test (standard preset / CloudFront status)",
  "source": {"type": "NO_SOURCE", "buildspec": buildspec},
  "artifacts": {"type": "NO_ARTIFACTS"},
  "environment": {
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
    "computeType": "BUILD_GENERAL1_LARGE",
    "environmentVariables": [
      {"name": "QUEUE_API_URL", "value": os.environ["QUEUE_API_URL"], "type": "PLAINTEXT"},
      {"name": "POLL_BASE_URL", "value": os.environ["POLL_BASE_URL"], "type": "PLAINTEXT"},
      {"name": "EVENT_ID", "value": os.environ["EVENT_ID"], "type": "PLAINTEXT"},
      {"name": "BUCKET", "value": os.environ["BUCKET"], "type": "PLAINTEXT"},
      {"name": "VUS", "value": os.environ["VUS"], "type": "PLAINTEXT"},
    ],
  },
  "serviceRole": f"arn:aws:iam::{os.environ['ACCOUNT']}:role/{os.environ['ROLE_NAME']}",
  "timeoutInMinutes": 45,
}
open("/tmp/vazue-standard-cb-project.json", "w").write(json.dumps(proj))
print("project ok")
PY

unproxy aws codebuild create-project --cli-input-json file:///tmp/vazue-standard-cb-project.json >/dev/null
BUILD_ID=$(unproxy aws codebuild start-build --project-name "$PROJECT" --query 'build.id' --output text)
echo "BUILD_ID=$BUILD_ID"

st=IN_PROGRESS
for i in $(seq 1 120); do
  st=$(unproxy aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)
  ph=$(unproxy aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].currentPhase' --output text)
  echo "build=$st phase=$ph ($i)"
  case "$st" in
    SUCCEEDED|FAILED|FAULT|STOPPED|TIMED_OUT) break ;;
  esac
  sleep 15
done
if [[ "$st" != "SUCCEEDED" ]]; then
  echo "ERROR: CodeBuild finished with status=$st"
  exit 1
fi

mkdir -p "$ROOT/docs/launch"
REPORT_JSON="$ROOT/docs/launch/load-test-standard-report-inregion.json"
unproxy aws s3 cp "s3://$BUCKET/load-test-report.json" "$REPORT_JSON"
unproxy aws s3 cp "s3://$BUCKET/k6.exit" /tmp/vazue-standard-k6.exit || true
K6_EXIT=$(cat /tmp/vazue-standard-k6.exit 2>/dev/null || echo 1)

DATE=$(date +%Y-%m-%d)
OUT_JSON="$ROOT/docs/launch/load-test-standard-${DATE}.json"
OUT_MD="$ROOT/docs/launch/load-test-standard-${DATE}.md"
cp "$REPORT_JSON" "$OUT_JSON"

python3 - "$OUT_MD" "$OUT_JSON" "$VUS" "$QUEUE_API_URL" "$WAITING_ROOM_URL" "$EVENT_ID" "$REGION" "$ACCOUNT" "$K6_EXIT" <<'PY'
import json, sys
from datetime import datetime, timezone

out_md, out_json, vus, api, cf, event_id, region, account, k6_exit = sys.argv[1:10]
report = json.load(open(out_json))
now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

def fmt(v, digits=1):
    return "—" if v is None else f"{float(v):.{digits}f}"

fail = report.get("http_req_failed_rate")
p50 = report.get("http_req_duration_p50")
p90 = report.get("http_req_duration_p90")
p95 = report.get("http_req_duration_p95")
p99 = report.get("http_req_duration_p99")
gate_fail = fail is not None and fail < 0.01
gate_p95 = p95 is not None and p95 < 250
gate_p99 = p99 is not None and p99 < 500
verdict = "PASS" if gate_fail and gate_p95 and (gate_p99 or p99 is None) else "FAIL"
basename = f"load-test-standard-{now.split()[0]}"
stack_name = "VazueQueueLoadTestStandard"

md = f"""# Load test standard preset — {now.split()[0]}

In-region `PROFILE=rc` run at **{vus}** concurrent status pollers on the **`standard`** preset. Enroll via API Gateway; status polls via **CloudFront** (edge-cached, 2–30s TTL keyed by `request_id`).

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| HTTP fail rate | < 1% | **{fmt(fail, 4) if fail is not None else '—'}** | {'Yes' if gate_fail else 'No'} |
| `http_req_duration` p95 | < 250ms | **{fmt(p95)}ms** | {'Yes' if gate_p95 else 'No'} |
| `http_req_duration` p99 | < 500ms | **{fmt(p99)}ms** | {'Yes' if gate_p99 else 'No'} |

**Overall:** {verdict} (k6 exit {k6_exit})

## Percentiles

| Percentile | Latency |
|------------|---------|
| p50 | **{fmt(p50)}ms** |
| p90 | **{fmt(p90)}ms** |
| p95 | **{fmt(p95)}ms** |
| p99 | **{fmt(p99)}ms** |

## Conditions

| Item | Value |
|------|--------|
| Date | {now} |
| AWS account | `{account}` |
| Region | **{region}** |
| Stack | `{stack_name}` (destroyed after run unless `SKIP_DESTROY=1`) |
| Preset | **`standard`** (CloudFront status cache + waiting room) |
| Enroll buffer | **off** |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` (enroll) | `{api}` |
| `WAITING_ROOM_URL` (status poll) | `{cf}` |
| `EVENT_ID` | `{event_id}` |
| Load generator | **k6 v0.54.0 on CodeBuild `BUILD_GENERAL1_LARGE` (us-east-1)** |
| Script | `scripts/run-load-test-standard-inregion.sh` → `scripts/load-test-status.js` |
| Profile | `rc` / **{vus}** VUs |
| Iterations | **{report.get('iterations', '—')}** |

## Raw metrics

Machine-readable copy: [`{basename}.json`](./{basename}.json)

```json
{json.dumps(report, indent=2)}
```
"""
open(out_md, "w").write(md)
print(out_md)
PY

echo "==== REPORT ===="
cat "$OUT_JSON"
echo "==== WROTE ===="
echo "$OUT_JSON"
echo "$OUT_MD"

python3 - "$OUT_JSON" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
fail = report.get("http_req_failed_rate")
p95 = report.get("http_req_duration_p95")
p99 = report.get("http_req_duration_p99")
ok = (
    fail is not None and fail < 0.01
    and p95 is not None and p95 < 250
    and (p99 is None or p99 < 500)
)
print("gate_pass=" + str(ok))
sys.exit(0 if ok else 1)
PY
