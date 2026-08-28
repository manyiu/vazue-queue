#!/usr/bin/env bash
# In-region PROFILE=rc load test via temporary CodeBuild + ephemeral CDK stack.
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
ACCOUNT=517206156255
REGION=us-east-1
PROJECT=vazue-loadtest-rc
ROLE_NAME=vazue-loadtest-rc-codebuild
BUCKET="vazue-loadtest-rc-${ACCOUNT}-$(date +%s)"
EVENT_ID=loadtest-rc
BUILD_ID=""
QUEUE_API_URL=""

eval "$(unproxy aws configure export-credentials --format env)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION="$REGION"

cleanup() {
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
  (
    cd "$ROOT/examples/load-test-rc"
    unproxy npx cdk destroy --force
  )
  echo "==> CLEANUP done"
}
trap cleanup EXIT

echo "==> deploy stack"
cd "$ROOT/examples/load-test-rc"
unproxy npx cdk deploy --require-approval never
QUEUE_API_URL=$(unproxy aws cloudformation describe-stacks --stack-name VazueQueueLoadTestRc \
  --query "Stacks[0].Outputs[?contains(OutputKey,'QueueApiUrl')].OutputValue" --output text)
echo "QUEUE_API_URL=$QUEUE_API_URL"

EVENTS_TABLE=$(unproxy aws cloudformation describe-stack-resources --stack-name VazueQueueLoadTestRc \
  --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && contains(LogicalResourceId,'Events')].PhysicalResourceId" \
  --output text)
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
for _ in $(seq 1 30); do unproxy curl -sf "$QUEUE_API_URL/v1/events/$EVENT_ID/status?request_id=$RID" >/dev/null; done
echo "warmed $RID"

echo "==> S3 bucket $BUCKET"
create_ephemeral_bucket "$BUCKET" "$REGION" >/dev/null
unproxy aws s3 cp "$ROOT/scripts/load-test-status.js" "s3://$BUCKET/load-test-status.js"

echo "==> CodeBuild role"
cat >/tmp/vazue-cb-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
unproxy aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file:///tmp/vazue-cb-trust.json >/dev/null
unproxy aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
cat >/tmp/vazue-cb-s3.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"]}]}
EOF
unproxy aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name s3access --policy-document file:///tmp/vazue-cb-s3.json
sleep 12

QUEUE_API_URL="$QUEUE_API_URL" BUCKET="$BUCKET" ACCOUNT="$ACCOUNT" PROJECT="$PROJECT" ROLE_NAME="$ROLE_NAME" python3 <<'PY'
import json, os
# Single multiline shell so set +e / exit codes persist. Quiet k6 avoids CodeBuild log-volume kills.
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
        echo "QUEUE_API_URL=$QUEUE_API_URL EVENT_ID=$EVENT_ID"
        set +e
        QUEUE_API_URL="$QUEUE_API_URL" EVENT_ID="$EVENT_ID" PROFILE=rc \\
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
  "description": "Ephemeral in-region k6 RC load test",
  "source": {"type": "NO_SOURCE", "buildspec": buildspec},
  "artifacts": {"type": "NO_ARTIFACTS"},
  "environment": {
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
    "computeType": "BUILD_GENERAL1_LARGE",
    "environmentVariables": [
      {"name": "QUEUE_API_URL", "value": os.environ["QUEUE_API_URL"], "type": "PLAINTEXT"},
      {"name": "EVENT_ID", "value": "loadtest-rc", "type": "PLAINTEXT"},
      {"name": "BUCKET", "value": os.environ["BUCKET"], "type": "PLAINTEXT"},
      {"name": "PROFILE", "value": "rc", "type": "PLAINTEXT"},
    ],
  },
  "serviceRole": f"arn:aws:iam::{os.environ['ACCOUNT']}:role/{os.environ['ROLE_NAME']}",
  "timeoutInMinutes": 45,
}
open("/tmp/vazue-cb-project.json", "w").write(json.dumps(proj))
print("project ok")
PY

unproxy aws codebuild create-project --cli-input-json file:///tmp/vazue-cb-project.json >/dev/null
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

mkdir -p "$ROOT/docs/launch"
unproxy aws s3 cp "s3://$BUCKET/load-test-report.json" "$ROOT/docs/launch/load-test-report-inregion.json" || true
unproxy aws s3 cp "s3://$BUCKET/k6.exit" /tmp/vazue-k6.exit || true
echo "==== REPORT ===="
cat "$ROOT/docs/launch/load-test-report-inregion.json" 2>/dev/null || echo "(missing)"
echo "==== K6_EXIT ===="
cat /tmp/vazue-k6.exit 2>/dev/null || true
echo "FINAL_BUILD_STATUS=$st"

# Keep exit 0 so cleanup still runs; gate evaluation is separate.
exit 0
