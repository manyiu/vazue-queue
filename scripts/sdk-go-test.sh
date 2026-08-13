#!/usr/bin/env bash
# Run packages/sdk-go tests in Docker (no local Go install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${VAZUE_GO_IMAGE:-golang:1.22-bookworm}"
docker run --rm \
  -v "$ROOT/packages/sdk-go:/src:ro" \
  -w /src \
  "$IMAGE" \
  go test -count=1 ./...
