#!/usr/bin/env bash
set -euo pipefail
BASE="${QUEUE_API_URL:?set QUEUE_API_URL}"
EVENT="${EVENT_ID:-demo}"
curl -sf "$BASE/health"
curl -sf -X POST "$BASE/v1/events/$EVENT/enroll" -H 'content-type: application/json' -d '{"return_url":"https://example.com"}'
echo
echo "smoke OK"
