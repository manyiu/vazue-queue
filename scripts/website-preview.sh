#!/usr/bin/env bash
# Build and preview the product website. Uses port 5200 to avoid clashes with dev (5190).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=5200

# Free the preview port if a stale VitePress process is still listening.
if command -v lsof >/dev/null 2>&1; then
  pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids:-}" ]]; then
    echo "==> stopping stale listener(s) on :$PORT"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
fi

cd "$ROOT"
rm -rf apps/website/.vitepress/dist apps/website/.vitepress/cache
pnpm website:build
echo ""
echo "==> Preview: http://127.0.0.1:$PORT/"
echo "    (use 127.0.0.1 — not localhost — if you previously had a dev server on another port)"
exec pnpm --filter @vazue/website preview
