#!/usr/bin/env bash
# Exploratory distributed in-region 100K VU load test (NOT an OSS v1 release gate).
# OSS v1 RC gate is 1000 VUs: scripts/run-load-test-rc-inregion.sh
# v1 waiver: docs/launch/load-test-100k-2026-08-28.md (quota/budget — do not block releases on this script).
#
# Usage:
#   bash scripts/run-load-test-100k-inregion.sh
#   VUS=100000 WORKERS=10 bash scripts/run-load-test-100k-inregion.sh
#   SKIP_DESTROY=1 bash scripts/run-load-test-100k-inregion.sh
#
# Each worker runs k6 with VUS / WORKERS concurrent pollers against the same event.
# Reports are aggregated with scripts/load-test-aggregate-reports.py.
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
STACK_NAME=VazueQueueLoadTestRc
REGION="${REGION:-us-east-1}"
EVENT_ID="${EVENT_ID:-loadtest-100k}"
VUS="${VUS:-100000}"
WORKERS="${WORKERS:-10}"
PROJECT="${PROJECT:-vazue-loadtest-100k}"
ROLE_NAME="${ROLE_NAME:-vazue-loadtest-100k-codebuild}"
BUILD_IDS=()
QUEUE_API_URL=""
BUCKET=""

if (( VUS % WORKERS != 0 )); then
  echo "ERROR: VUS ($VUS) must divide evenly by WORKERS ($WORKERS)"
  exit 1
fi
WORKER_VUS=$((VUS / WORKERS))

cleanup() {
  if [[ "${SKIP_DESTROY:-}" == "1" ]]; then
    echo "==> SKIP_DESTROY=1 — stack and bucket left up"
    return
  fi
  set +e
  echo "==> CLEANUP"
  for id in "${BUILD_IDS[@]}"; do
    unproxy aws codebuild stop-build --id "$id" >/dev/null 2>&1
  done
  unproxy aws codebuild delete-project --name "$PROJECT" >/dev/null 2>&1
  if [[ -n "${BUCKET:-}" ]]; then
    unproxy aws s3 rm "s3://$BUCKET" --recursive >/dev/null 2>&1
    unproxy aws s3api delete-bucket --bucket "$BUCKET" >/dev/null 2>&1
  fi
  unproxy aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess >/dev/null 2>&1
  unproxy aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name s3access >/dev/null 2>&1
  unproxy aws iam delete-role --role-name "$ROLE_NAME" >/dev/null 2>&1
  (cd "$ROOT/examples/load-test-rc" && unproxy npx cdk destroy "$STACK_NAME" --force)
  echo "==> CLEANUP done"
}
trap cleanup EXIT

echo "==> AWS credentials"
eval "$(unproxy aws configure export-credentials --format env)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
ACCOUNT=$(unproxy aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION="$REGION"
BUCKET="vazue-loadtest-100k-${ACCOUNT}-$(date +%s)"
echo "account=$ACCOUNT region=$REGION vus=$VUS workers=$WORKERS worker_vus=$WORKER_VUS"

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
  (cd "$ROOT/examples/load-test-rc" && unproxy npx cdk deploy "$STACK_NAME" --require-approval never)
fi

QUEUE_API_URL=$(unproxy aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?contains(OutputKey,'QueueApiUrl')].OutputValue" --output text)
EVENTS_TABLE=$(unproxy aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && contains(LogicalResourceId,'Events')].PhysicalResourceId" \
  --output text)

echo "QUEUE_API_URL=$QUEUE_API_URL"
echo "EVENTS_TABLE=$EVENTS_TABLE"
[[ -n "$QUEUE_API_URL" && -n "$EVENTS_TABLE" ]] || { echo "ERROR: missing stack outputs"; exit 1; }

echo "==> seed event $EVENT_ID"
unproxy aws dynamodb put-item --table-name "$EVENTS_TABLE" --item "{
  \"tenantId\":{\"S\":\"default\"},
  \"eventId\":{\"S\":\"$EVENT_ID\"},
  \"roomId\":{\"S\":\"default\"},
  \"throughputPerMinute\":{\"N\":\"1000\"},
  \"paused\":{\"BOOL\":false},
  \"emergencyOpen\":{\"BOOL\":false},
  \"dressRehearsal\":{\"BOOL\":false},
  \"botProtection\":{\"S\":\"off\"},
  \"returnUrl\":{\"S\":\"https://example.com/checkout\"}
}"

ENROLL=$(unproxy curl -sS -X POST "$QUEUE_API_URL/v1/events/$EVENT_ID/enroll" -H 'Content-Type: application/json' -d '{}')
RID=$(printf '%s' "$ENROLL" | python3 -c 'import sys,json; print(json.load(sys.stdin)["request_id"])')
for _ in $(seq 1 30); do unproxy curl -sf "$QUEUE_API_URL/v1/events/$EVENT_ID/status?request_id=$RID" >/dev/null; done
echo "warmed request_id=$RID"

echo "==> S3 bucket $BUCKET"
create_ephemeral_bucket "$BUCKET" "$REGION" >/dev/null
unproxy aws s3 cp "$ROOT/scripts/load-test-status.js" "s3://$BUCKET/load-test-status.js"

echo "==> CodeBuild role"
cat >/tmp/vazue-100k-cb-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
unproxy aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file:///tmp/vazue-100k-cb-trust.json >/dev/null
unproxy aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
cat >/tmp/vazue-100k-cb-s3.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"]}]}
EOF
unproxy aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name s3access --policy-document file:///tmp/vazue-100k-cb-s3.json
sleep 12

QUEUE_API_URL="$QUEUE_API_URL" BUCKET="$BUCKET" ACCOUNT="$ACCOUNT" PROJECT="$PROJECT" ROLE_NAME="$ROLE_NAME" \
  WORKER_VUS="$WORKER_VUS" EVENT_ID="$EVENT_ID" python3 <<'PY'
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
        echo "worker=$WORKER_ID vus=$VUS api=$QUEUE_API_URL event=$EVENT_ID"
        set +e
        QUEUE_API_URL="$QUEUE_API_URL" EVENT_ID="$EVENT_ID" PROFILE=rc VUS="$VUS" WORKER_ID="$WORKER_ID" \\
          k6 run --quiet --log-output=stderr ./load-test-status.js
        K6_EXIT=$?
        set -e
        echo "k6_exit=$K6_EXIT"
        test -f load-test-report.json
        cat load-test-report.json
        aws s3 cp load-test-report.json "s3://$BUCKET/reports/load-test-report-${WORKER_ID}.json"
        echo "$K6_EXIT" > "k6-${WORKER_ID}.exit"
        aws s3 cp "k6-${WORKER_ID}.exit" "s3://$BUCKET/k6-${WORKER_ID}.exit"
        exit 0
"""
proj = {
  "name": os.environ["PROJECT"],
  "description": "Ephemeral in-region distributed k6 100K load test worker",
  "source": {"type": "NO_SOURCE", "buildspec": buildspec},
  "artifacts": {"type": "NO_ARTIFACTS"},
  "environment": {
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
    "computeType": "BUILD_GENERAL1_2XLARGE",
    "environmentVariables": [
      {"name": "QUEUE_API_URL", "value": os.environ["QUEUE_API_URL"], "type": "PLAINTEXT"},
      {"name": "EVENT_ID", "value": os.environ["EVENT_ID"], "type": "PLAINTEXT"},
      {"name": "BUCKET", "value": os.environ["BUCKET"], "type": "PLAINTEXT"},
      {"name": "VUS", "value": os.environ["WORKER_VUS"], "type": "PLAINTEXT"},
      {"name": "WORKER_ID", "value": "0", "type": "PLAINTEXT"},
    ],
  },
  "serviceRole": f"arn:aws:iam::{os.environ['ACCOUNT']}:role/{os.environ['ROLE_NAME']}",
  "timeoutInMinutes": 60,
}
open("/tmp/vazue-100k-cb-project.json", "w").write(json.dumps(proj))
print("project ok")
PY

unproxy aws codebuild create-project --cli-input-json file:///tmp/vazue-100k-cb-project.json >/dev/null

echo "==> start $WORKERS parallel CodeBuild workers"
for w in $(seq 0 $((WORKERS - 1))); do
  id=$(unproxy aws codebuild start-build \
    --project-name "$PROJECT" \
    --environment-variables-override \
      "name=WORKER_ID,value=$w,type=PLAINTEXT" \
      "name=VUS,value=$WORKER_VUS,type=PLAINTEXT" \
    --query 'build.id' --output text)
  BUILD_IDS+=("$id")
  echo "worker=$w build_id=$id"
done

echo "==> wait for workers"
pending=1
for i in $(seq 1 240); do
  pending=0
  for id in "${BUILD_IDS[@]}"; do
    st=$(unproxy aws codebuild batch-get-builds --ids "$id" --query 'builds[0].buildStatus' --output text)
    case "$st" in
      SUCCEEDED|FAILED|FAULT|STOPPED|TIMED_OUT) ;;
      *) pending=1 ;;
    esac
  done
  echo "poll=$i pending=$pending"
  [[ "$pending" -eq 0 ]] && break
  sleep 15
done
if [[ "$pending" -ne 0 ]]; then
  echo "ERROR: timed out waiting for CodeBuild workers (240 polls × 15s)"
  exit 1
fi
for w in $(seq 0 $((WORKERS - 1))); do
  st=$(unproxy aws codebuild batch-get-builds --ids "${BUILD_IDS[$w]}" --query 'builds[0].buildStatus' --output text)
  if [[ "$st" != "SUCCEEDED" ]]; then
    echo "ERROR: worker=$w build_status=$st"
    exit 1
  fi
done

REPORT_DIR="/tmp/vazue-100k-reports-$$"
rm -rf "$REPORT_DIR"
mkdir -p "$ROOT/docs/launch" "$REPORT_DIR"
REPORT_FILES=()
for w in $(seq 0 $((WORKERS - 1))); do
  dest="$REPORT_DIR/load-test-report-${w}.json"
  unproxy aws s3 cp "s3://$BUCKET/reports/load-test-report-${w}.json" "$dest" || true
  [[ -f "$dest" ]] && REPORT_FILES+=("$dest")
done

if [[ ${#REPORT_FILES[@]} -ne "$WORKERS" ]]; then
  echo "ERROR: expected $WORKERS worker reports, got ${#REPORT_FILES[@]}"
  ls -la "$REPORT_DIR" || true
  exit 1
fi
AGG="$REPORT_DIR/aggregate.json"
python3 "$ROOT/scripts/load-test-aggregate-reports.py" "${REPORT_FILES[@]}" > "$AGG" 2>/dev/null || {
  echo "ERROR: could not aggregate worker reports (missing files?)"
  ls -la "$REPORT_DIR" || true
  exit 1
}

DATE=$(date +%Y-%m-%d)
if [[ "$VUS" -eq 10000 ]]; then
  OUT_JSON="$ROOT/docs/launch/load-test-10k-${DATE}.json"
  OUT_MD="$ROOT/docs/launch/load-test-10k-${DATE}.md"
else
  OUT_JSON="$ROOT/docs/launch/load-test-100k-${DATE}.json"
  OUT_MD="$ROOT/docs/launch/load-test-100k-${DATE}.md"
fi
cp "$AGG" "$OUT_JSON"

python3 - "$OUT_MD" "$OUT_JSON" "$VUS" "$WORKERS" "$WORKER_VUS" "$QUEUE_API_URL" "$EVENT_ID" "$REGION" "$ACCOUNT" <<'PY'
import json, sys
from datetime import datetime, timezone

out_md, out_json, vus, workers, worker_vus, api, event_id, region, account = sys.argv[1:10]
report = json.load(open(out_json))
now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

def fmt(v, digits=1):
    return "—" if v is None else f"{float(v):.{digits}f}"

fail = report.get("http_req_failed_rate")
# Conservative gate: max worker percentile when distributed (not a true global percentile).
p95 = report.get("http_req_duration_p95_max") or report.get("http_req_duration_p95")
p99 = report.get("http_req_duration_p99_max") or report.get("http_req_duration_p99")
gate_fail = fail is not None and fail < 0.01
gate_p95 = p95 is not None and p95 < 250
gate_p99 = p99 is not None and p99 < 500
verdict = "PASS" if gate_fail and gate_p95 and (gate_p99 or p99 is None) else "FAIL"
label = "10K" if int(vus) == 10000 else "100K"
basename = f"load-test-{label.lower()}-{now.split()[0]}"

md = f"""# Load test {label} record — {now.split()[0]}

Distributed **in-region** `PROFILE=rc` run at **{vus}** concurrent pollers via **{workers}** CodeBuild workers ({worker_vus} VUs each).

## Verdict

| Gate | Threshold | Observed | Pass? |
|------|-----------|----------|-------|
| HTTP fail rate | < 1% | **{fmt(fail, 4) if fail is not None else '—'}** | {'Yes' if gate_fail else 'No'} |
| `http_req_duration` p95 | < 250ms | **{fmt(p95)}ms** | {'Yes' if gate_p95 else 'No'} |
| `http_req_duration` p99 | < 500ms | **{fmt(p99)}ms** | {'Yes' if gate_p99 else 'No'} |

**Overall:** {verdict}

## Conditions

| Item | Value |
|------|--------|
| Date | {now} |
| AWS account | `{account}` |
| Region | **{region}** |
| Stack | `VazueQueueLoadTestRc` (destroyed after run unless `SKIP_DESTROY=1`) |
| Preset | **`minimal`** (API Gateway → Lambda → DynamoDB) |
| Enroll buffer | **off** |
| Lambda memory | **512 MB** |
| `QUEUE_API_URL` | `{api}` |
| `EVENT_ID` | `{event_id}` |
| Load generator | **k6 v0.54.0 on {workers}× CodeBuild `BUILD_GENERAL1_2XLARGE` (us-east-1)** |
| Script | `scripts/run-load-test-100k-inregion.sh` → `scripts/load-test-status.js` |
| Profile | `rc` / **{vus}** total VUs |
| Iterations (aggregate) | **{report.get('iterations', '—')}** |

## Raw metrics

Machine-readable copy: [`{basename}.json`](./{basename}.json)

```json
{json.dumps({k: report[k] for k in report if k != 'worker_reports'}, indent=2)}
```
"""
open(out_md, "w").write(md)
print(out_md)
PY

echo "==== AGGREGATE REPORT ===="
cat "$AGG"
echo "==== WROTE ===="
echo "$OUT_JSON"
echo "$OUT_MD"

# Keep exit 0 so cleanup still runs; gate evaluation is informational for exploratory runs.
exit 0
