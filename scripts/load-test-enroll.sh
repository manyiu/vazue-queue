#!/usr/bin/env bash
# Enroll burst load test — each VU performs one unique POST enroll.
# Usage:
#   bash scripts/load-test-enroll.sh
#   PROFILE=rc VUS=1000 bash scripts/load-test-enroll.sh
#   POLL_AFTER_ENROLL=1 bash scripts/load-test-enroll.sh
# In-region helper: bash scripts/run-load-test-enroll-inregion.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PROFILE="${PROFILE:-smoke}"
export VUS="${VUS:-}"
export QUEUE_API_URL="${QUEUE_API_URL:-http://localhost:3000}"
export EVENT_ID="${EVENT_ID:-demo}"
export POLL_AFTER_ENROLL="${POLL_AFTER_ENROLL:-}"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required: https://k6.io/docs/get-started/installation/"
  exit 1
fi

echo "==> k6 enroll burst profile=$PROFILE vus=${VUS:-default} api=$QUEUE_API_URL event=$EVENT_ID"
k6 run "$ROOT/scripts/load-test-enroll.js"
echo "==> wrote load-test-report.json (cwd)"
if [[ -f load-test-report.json ]]; then
  echo "SLO report:"
  cat load-test-report.json
fi
