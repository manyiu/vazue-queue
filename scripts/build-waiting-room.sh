#!/usr/bin/env bash
# Build static waiting-room assets for CDK BucketDeployment.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @vazue/waiting-room build
echo "waiting-room dist ready: $ROOT/apps/waiting-room/dist"
