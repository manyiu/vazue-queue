#!/usr/bin/env bash
set -euo pipefail
# Contract smoke against local-server (start separately on :3000)
BASE="${QUEUE_API_URL:-http://localhost:3000}"
curl -sf "$BASE/health" >/dev/null
READY=$(curl -sf "$BASE/ready")
echo "$READY" | grep -q '"tenantId"'
echo "$READY" | grep -q '"status"'
if echo "$READY" | grep -q '"deployment"'; then
  echo "ERROR: /ready must not include deployment profile (OSS-only product)" >&2
  exit 1
fi
EVENT=demo
ENROLL=$(curl -sf -X POST "$BASE/v1/events/$EVENT/enroll" -H 'content-type: application/json' -d '{}')
RID=$(echo "$ENROLL" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
curl -sf "$BASE/v1/events/$EVENT/status?request_id=$RID" >/dev/null
echo "API contract smoke OK"
