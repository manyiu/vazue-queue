#!/usr/bin/env bash
# Fail if commercial SaaS packages would be published to npm.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ALLOWED_PUBLISH=(
  "@vazue/queue-cdk"
  "create-vazue-queue"
  "@vazue/queue-sdk"
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

# No publishConfig.access on saas packages
if grep -R --include='package.json' -l '"publishConfig"' packages/saas 2>/dev/null | grep -q .; then
  echo "ERROR: packages/saas must not declare publishConfig"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "publish boundary OK"
