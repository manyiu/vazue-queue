#!/usr/bin/env bash
# Load test gate for status pollers.
# Usage:
#   bash scripts/load-test-100k.sh              # smoke (50 VUs)
#   PROFILE=stress VUS=500 bash scripts/load-test-100k.sh
#   PROFILE=rc VUS=1000 bash scripts/load-test-100k.sh
# Full 100K concurrent pollers: PROFILE=rc VUS=100000 on distributed k6 / AWS DLTS.
# In-region helper: bash scripts/run-load-test-100k-inregion.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PROFILE="${PROFILE:-smoke}"
export VUS="${VUS:-}"
export QUEUE_API_URL="${QUEUE_API_URL:-http://localhost:3000}"
export EVENT_ID="${EVENT_ID:-demo}"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required: https://k6.io/docs/get-started/installation/"
  exit 1
fi

echo "==> k6 profile=$PROFILE vus=${VUS:-default} api=$QUEUE_API_URL event=$EVENT_ID"
k6 run "$ROOT/scripts/load-test-status.js"
echo "==> wrote load-test-report.json (cwd)"
if [[ -f load-test-report.json ]]; then
  echo "SLO report:"
  cat load-test-report.json
fi
