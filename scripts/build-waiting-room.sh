#!/usr/bin/env bash
# Build static waiting-room assets for CDK BucketDeployment.
# Copies into packages/cdk/assets/waiting-room for npm package consumers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @vazue/waiting-room build
DEST="$ROOT/packages/cdk/assets/waiting-room"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$ROOT/apps/waiting-room/dist/." "$DEST/"
echo "waiting-room dist ready: $ROOT/apps/waiting-room/dist"
echo "vendored for CDK: $DEST"
