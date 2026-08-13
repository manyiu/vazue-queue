#!/usr/bin/env bash
# k6 load test scaffold — 100K pollers is run in CI RC with higher VUs.
# Usage: k6 run scripts/load-test-status.js
set -euo pipefail
echo "See scripts/load-test-status.js — requires k6 installed"
k6 run "$(dirname "$0")/load-test-status.js"
