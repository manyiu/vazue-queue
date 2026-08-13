#!/usr/bin/env bash
# Build static admin portal (Next.js export → apps/admin-portal/out + CDK assets).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export NEXT_PUBLIC_ADMIN_DEV_AUTH="${NEXT_PUBLIC_ADMIN_DEV_AUTH:-1}"
export NEXT_PUBLIC_ADMIN_API="${NEXT_PUBLIC_ADMIN_API:-http://localhost:3001}"
pnpm --filter @vazue/admin-portal build
DEST="$ROOT/packages/cdk/assets/admin-portal"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$ROOT/apps/admin-portal/out/." "$DEST/"
echo "admin-portal out ready: $ROOT/apps/admin-portal/out"
echo "vendored for CDK: $DEST"
