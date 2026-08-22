#!/usr/bin/env bash
# Fail if commercial SaaS packages would be published to npm,
# or if any package outside the OSS allow-list declares public publishConfig.
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
while IFS= read -r pkg; do
  name=$(node -e "console.log(require('./$pkg').name)")
  private=$(node -e "console.log(Boolean(require('./$pkg').private))")
  if [[ "$name" == @vazue/saas-* ]]; then
    if [[ "$private" != "true" ]]; then
      echo "ERROR: $name must set private:true"
      fail=1
    fi
  fi
done < <(find packages/saas -name package.json -maxdepth 2)

# Changesets ignore must list every saas package
for name in @vazue/saas-plan-limits @vazue/saas-billing @vazue/saas-cdk; do
  if ! grep -q "\"$name\"" .changeset/config.json; then
    echo "ERROR: $name missing from .changeset/config.json ignore"
    fail=1
  fi
done

# No publishConfig on saas workspace packages (exclude node_modules — Linux grep -R follows pnpm symlinks).
while IFS= read -r pkg; do
  if grep -q '"publishConfig"' "$pkg"; then
    echo "ERROR: packages/saas must not declare publishConfig ($pkg)"
    fail=1
  fi
done < <(find packages/saas -name package.json -not -path '*/node_modules/*')

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
