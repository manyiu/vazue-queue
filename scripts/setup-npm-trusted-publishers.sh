#!/usr/bin/env bash
# Bootstrap OSS packages on npm (first publish) then register GitHub Actions OIDC trusted publishers.
# Run locally while logged in as npm user yiu: npm whoami
#
# npm trust returns 404 until the package exists — this script publishes first when needed.
# Browser 2FA may be required for publish and/or trust (complete prompts in the terminal).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${REPO:-manyiu/vazue-queue}"
WORKFLOW="${WORKFLOW:-release.yml}"

# name|directory (relative to repo root)
PACKAGES=(
  "@yiu/queue-sdk|packages/sdk-typescript"
  "create-vazue-queue|packages/create-vazue-queue"
  "@yiu/queue-cdk|packages/cdk"
)

echo "==> npm user: $(npm whoami)"
echo "==> trusted publisher target: GitHub Actions $REPO / $WORKFLOW"
echo

package_exists() {
  npm view "$1" version >/dev/null 2>&1
}

bootstrap_publish() {
  local name="$1"
  local dir="$2"
  echo "==> bootstrap publish $name (first publish from $dir)"
  (cd "$dir" && npm publish --access public)
}

configure_trust() {
  local name="$1"
  echo "==> trusted publisher $name"
  npm trust github "$name" \
    --repo "$REPO" \
    --file "$WORKFLOW" \
    --allow-publish \
    -y
  npm trust list "$name" || true
}

echo "==> building publishable packages"
pnpm --filter @yiu/queue-sdk build
pnpm --filter create-vazue-queue build
pnpm --filter @yiu/queue-cdk build
echo

for entry in "${PACKAGES[@]}"; do
  name="${entry%%|*}"
  dir="${entry#*|}"
  echo "=== $name ==="
  if package_exists "$name"; then
    echo "    already on npm: $(npm view "$name" version)"
  else
    bootstrap_publish "$name" "$dir"
  fi
  configure_trust "$name"
  echo
done

echo "Done."
echo "  npm view @yiu/queue-cdk version"
echo "  npm view @yiu/queue-sdk version"
echo "  npm view create-vazue-queue version"
echo "Future releases: merge to main → Release workflow (OIDC, no NPM_TOKEN)."
