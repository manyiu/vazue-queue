#!/usr/bin/env bash
# Fail if any package outside the OSS allow-list declares public publishConfig.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ALLOWED_PUBLISH=(
  "@yiu/queue-cdk"
  "create-vazue-queue"
  "@yiu/queue-sdk"
)

echo "==> OSS publish boundary (only these packages may publish):"
printf '  - %s\n' "${ALLOWED_PUBLISH[@]}"

fail=0

# Only allow-listed packages may declare public publishConfig.
while IFS= read -r pkg; do
  name=$(node -e "console.log(require('./$pkg').name)")
  access=$(node -e "const p=require('./$pkg'); console.log(p.publishConfig&&p.publishConfig.access||'')")
  if [[ "$access" == "public" ]]; then
    allowed=0
    for a in "${ALLOWED_PUBLISH[@]}"; do
      if [[ "$name" == "$a" ]]; then allowed=1; break; fi
    done
    if [[ "$allowed" -ne 1 ]]; then
      echo "ERROR: $name has publishConfig.access=public but is not in the OSS allow-list"
      fail=1
    fi
  fi
done < <(find packages connectors apps -name package.json -not -path '*/node_modules/*' 2>/dev/null)

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "publish boundary OK"
