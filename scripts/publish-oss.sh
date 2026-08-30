#!/usr/bin/env bash
# Build Lambda zips then publish OSS packages (changesets publish path only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$ROOT/scripts/build-lambda-assets.sh"
REQUIRE_ARTIFACTS=1 "$ROOT/scripts/build-lambda-assets.sh"
cd "$ROOT"
pnpm exec changeset publish
