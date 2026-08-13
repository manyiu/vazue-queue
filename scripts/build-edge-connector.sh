#!/usr/bin/env bash
# Build CloudFront edge connector and vendor into CDK assets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @vazue/queue-edge-cloudfront build
DEST="$ROOT/packages/cdk/assets/edge-cloudfront"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$ROOT/connectors/cloudfront-lambda-edge/dist/." "$DEST/"
echo "edge connector ready: $DEST"
