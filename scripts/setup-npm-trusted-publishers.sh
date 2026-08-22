#!/usr/bin/env bash
# Register GitHub Actions OIDC trusted publishers on npm for OSS packages.
# Run locally while logged in as npm user yiu: npm whoami
#
# Requires npm CLI with `npm trust` (npm 11.5.1+). May open a browser for 2FA.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${REPO:-manyiu/vazue-queue}"
WORKFLOW="${WORKFLOW:-release.yml}"

PACKAGES=(
  "@yiu/queue-cdk"
  "@yiu/queue-sdk"
  "create-vazue-queue"
)

echo "==> npm user: $(npm whoami)"
echo "==> trusted publisher: GitHub Actions $REPO / $WORKFLOW"
echo

for pkg in "${PACKAGES[@]}"; do
  echo "==> $pkg"
  npm trust github "$pkg" \
    --repo "$REPO" \
    --file "$WORKFLOW" \
    --allow-publish \
    -y
  npm trust list "$pkg" || true
  echo
done

echo "Done. Verify on npmjs.com → package → Settings → Trusted publishing."
