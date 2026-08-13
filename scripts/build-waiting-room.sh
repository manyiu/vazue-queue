#!/usr/bin/env bash
# Build static waiting-room assets for CDK BucketDeployment.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/waiting-room"
pnpm install --ignore-workspace 2>/dev/null || true
pnpm exec vite build
echo "waiting-room dist ready: $ROOT/apps/waiting-room/dist"
