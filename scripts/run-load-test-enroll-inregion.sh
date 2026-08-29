#!/usr/bin/env bash
# In-region PROFILE=rc enroll burst load test via temporary CodeBuild + ephemeral CDK stack.
#
# Each virtual user performs one unique POST enroll (flash-traffic shape).
#
# Usage:
#   bash scripts/run-load-test-enroll-inregion.sh
#   VUS=1000 bash scripts/run-load-test-enroll-inregion.sh
#   POLL_AFTER_ENROLL=1 bash scripts/run-load-test-enroll-inregion.sh
#   SKIP_DESTROY=1 bash scripts/run-load-test-enroll-inregion.sh
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
STACK_NAME=VazueQueueLoadTestEnroll
REGION="${REGION:-us-east-1}"
EVENT_ID="${EVENT_ID:-loadtest-enroll}"
VUS="${VUS:-1000}"
PROJECT="${PROJECT:-vazue-loadtest-enroll}"
ROLE_NAME="${ROLE_NAME:-vazue-loadtest-enroll-codebuild}"
POLL_AFTER_ENROLL="${POLL_AFTER_ENROLL:-}"
BUILD_ID=""
QUEUE_API_URL=""
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
  (cd "$ROOT/examples/load-test-enroll" && unproxy npx cdk destroy "$STACK_NAME" --force)
  echo "==> CLEANUP done"
}
trap cleanup EXIT

echo "==> AWS credentials"
eval "$(unproxy aws configure export-credentials --format env)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
ACCOUNT=$(unproxy aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION="$REGION"
BUCKET="vazue-loadtest-enroll-${ACCOUNT}-$(date +%s)"
echo "account=$ACCOUNT region=$REGION vus=$VUS"

if [[ "${SKIP_DEPLOY:-}" != "1" ]]; then
  echo "==> pnpm install"
  (cd "$ROOT" && pnpm install --frozen-lockfile)

  if [[ "${SKIP_BUILD:-}" != "1" ]]; then
    echo "==> build lambda artifacts"
    REQUIRE_ARTIFACTS=1 bash "$ROOT/scripts/build-lambda-assets.sh"
  else
    echo "==> SKIP_BUILD=1"
  fi

  echo "==> build @yiu/queue-cdk"
  pnpm --filter @yiu/queue-cdk build

  echo "==> deploy stack ($STACK_NAME)"
  (cd "$ROOT/examples/load-test-enroll" && unproxy npx cdk deploy "$STACK_NAME" --require-approval never)
fi

QUEUE_API_URL=$(unproxy aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?contains(OutputKey,'QueueApiUrl')].OutputValue" --output text)
EVENTS_TABLE=$(unproxy aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && contains(LogicalResourceId,'Events')].PhysicalResourceId" \
  --output text)

echo "QUEUE_API_URL=$QUEUE_API_URL"
echo "EVENTS_TABLE=$EVENTS_TABLE"
[[ -n "$QUEUE_API_URL" && -n "$EVENTS_TABLE" ]] || {
  echo "ERROR: missing stack outputs"
  exit 1
}

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

echo "==> warm enroll path"
ENROLL=$(unproxy curl -sS -X POST "$QUEUE_API_URL/v1/events/$EVENT_ID/enroll" -H 'Content-Type: application/json' -d '{}')
RID=$(printf '%s' "$ENROLL" | python3 -c 'import sys,json; print(json.load(sys.stdin)["request_id"])')
unproxy curl -sf "${CURL_OPTS[@]}" "$QUEUE_API_URL/v1/events/$EVENT_ID/status?request_id=$RID" >/dev/null
echo "warmed request_id=$RID"

echo "==> S3 bucket $BUCKET"
create_ephemeral_bucket "$BUCKET" "$REGION" >/dev/null
unproxy aws s3 cp "$ROOT/scripts/load-test-enroll.js" "s3://$BUCKET/load-test-enroll.js"

echo "==> CodeBuild role"
cat >/tmp/vazue-enroll-cb-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
unproxy aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file:///tmp/vazue-enroll-cb-trust.json >/dev/null
unproxy aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
cat >/tmp/vazue-enroll-cb-s3.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"]}]}
EOF
unproxy aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name s3access --policy-document file:///tmp/vazue-enroll-cb-s3.json
sleep 12

QUEUE_API_URL="$QUEUE_API_URL" BUCKET="$BUCKET" ACCOUNT="$ACCOUNT" PROJECT="$PROJECT" ROLE_NAME="$ROLE_NAME" EVENT_ID="$EVENT_ID" VUS="$VUS" POLL_AFTER_ENROLL="$POLL_AFTER_ENROLL" python3 <<'PY'
import json, os
poll = os.environ.get("POLL_AFTER_ENROLL", "")
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
        aws s3 cp "s3://$BUCKET/load-test-enroll.js" ./load-test-enroll.js
        echo "QUEUE_API_URL=$QUEUE_API_URL EVENT_ID=$EVENT_ID VUS=$VUS"
        set +e
        QUEUE_API_URL="$QUEUE_API_URL" EVENT_ID="$EVENT_ID" PROFILE=rc VUS="$VUS" POLL_AFTER_ENROLL="${POLL_AFTER_ENROLL:-}" \\
          k6 run --quiet --log-output=stderr ./load-test-enroll.js
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
env_vars = [
  {"name": "QUEUE_API_URL", "value": os.environ["QUEUE_API_URL"], "type": "PLAINTEXT"},
  {"name": "EVENT_ID", "value": os.environ["EVENT_ID"], "type": "PLAINTEXT"},
  {"name": "BUCKET", "value": os.environ["BUCKET"], "type": "PLAINTEXT"},
  {"name": "PROFILE", "value": "rc", "type": "PLAINTEXT"},
  {"name": "VUS", "value": os.environ["VUS"], "type": "PLAINTEXT"},
]
if poll:
  env_vars.append({"name": "POLL_AFTER_ENROLL", "value": poll, "type": "PLAINTEXT"})
proj = {
  "name": os.environ["PROJECT"],
  "description": "Ephemeral in-region k6 enroll burst load test",
  "source": {"type": "NO_SOURCE", "buildspec": buildspec},
  "artifacts": {"type": "NO_ARTIFACTS"},
  "environment": {
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
    "computeType": "BUILD_GENERAL1_LARGE",
    "environmentVariables": env_vars,
  },
  "serviceRole": f"arn:aws:iam::{os.environ['ACCOUNT']}:role/{os.environ['ROLE_NAME']}",
  "timeoutInMinutes": 45,
}
open("/tmp/vazue-enroll-cb-project.json", "w").write(json.dumps(proj))
print("project ok")
PY

unproxy aws codebuild create-project --cli-input-json file:///tmp/vazue-enroll-cb-project.json >/dev/null
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
REPORT_JSON="$ROOT/docs/launch/load-test-enroll-report-inregion.json"
unproxy aws s3 cp "s3://$BUCKET/load-test-report.json" "$REPORT_JSON"
unproxy aws s3 cp "s3://$BUCKET/k6.exit" /tmp/vazue-enroll-k6.exit || true
K6_EXIT=$(cat /tmp/vazue-enroll-k6.exit 2>/dev/null || echo 1)

DATE=$(date +%Y-%m-%d)
OUT_JSON="$ROOT/docs/launch/load-test-enroll-${DATE}.json"
OUT_MD="$ROOT/docs/launch/load-test-enroll-${DATE}.md"
cp "$REPORT_JSON" "$OUT_JSON"

python3 - "$OUT_MD" "$OUT_JSON" "$VUS" "$QUEUE_API_URL" "$EVENT_ID" "$REGION" "$ACCOUNT" "$K6_EXIT" "$POLL_AFTER_ENROLL" <<'PY'
import json, sys
from datetime import datetime, timezone

out_md, out_json, vus, api, event_id, region, account, k6_exit, poll_after = sys.argv[1:10]
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
verdict = "PASS" if gate_fail else "FAIL"
basename = f"load-test-enroll-{now.split()[0]}"
stack_name = "VazueQueueLoadTestEnroll"
poll_note = "yes (one GET status per enroll)" if poll_after == "1" else "no (enroll only)"

md = f"""# Load test enroll burst — {now.split()[0]}

In-region `PROFILE=rc` run at **{vus}** unique concurrent enrolls on the **`minimal`** preset (`enrollBuffer: false`). Each virtual user performs one `POST …/enroll` with a unique `session_id`.

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| Enroll HTTP fail rate | < 1% | **{fmt(fail, 4) if fail is not None else '—'}** | {'Yes' if gate_fail else 'No'} |
| Enroll POST p95 | informational | **{fmt(p95)}ms** | — |

**Overall:** {verdict} (k6 exit {k6_exit})

## Percentiles (enroll only)

| Percentile | Latency |
|------------|---------|
| p50 | **{fmt(p50)}ms** |
| p90 | **{fmt(p90)}ms** |
| p95 | **{fmt(p95)}ms** |
| p99 | **{fmt(p99)}ms** |

## Interpretation

- **{vus} unique enrolls** fired concurrently (one per VU) — flash-traffic shape at on-sale.
- Status polling after enroll: **{poll_note}**.
- Compare with status-only gates ([`load-test-rc-2026-08-22-inregion.md`](./load-test-rc-2026-08-22-inregion.md)): enroll writes DynamoDB counters + visitor rows; expect higher latency than GET status.

## Conditions

| Item | Value |
|------|--------|
| Date | {now} |
| AWS account | `{account}` |
| Region | **{region}** |
| Stack | `{stack_name}` (destroyed after run unless `SKIP_DESTROY=1`) |
| Preset | **`minimal`** (synchronous enroll, no buffer) |
| Enroll buffer | **off** |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` | `{api}` |
| `EVENT_ID` | `{event_id}` |
| Load generator | **k6 v0.54.0 on CodeBuild `BUILD_GENERAL1_LARGE` (us-east-1)** |
| Script | `scripts/run-load-test-enroll-inregion.sh` → `scripts/load-test-enroll.js` |
| Profile | `rc` / **{vus}** VUs (1 enroll each) |
| Enrollments | **{report.get('enrollments', '—')}** |

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
ok = fail is not None and fail < 0.01
print("gate_pass=" + str(ok))
sys.exit(0 if ok else 1)
PY
