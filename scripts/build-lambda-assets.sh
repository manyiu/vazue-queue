#!/usr/bin/env bash
# Build Rust Lambda zips into packages/cdk/assets/lambda/ for @vazue/queue-cdk.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/packages/cdk/assets/lambda"
mkdir -p "$OUT"

if ! command -v cargo-lambda >/dev/null 2>&1; then
  echo "cargo-lambda not installed; creating stub marker files only"
  for bin in enroll status admit serving-reaper enroll-worker admin-api; do
    echo "stub" > "$OUT/$bin.MISSING"
  done
  exit 0
fi

cd "$ROOT/packages/core-rust"
ARCH="${LAMBDA_ARCH:-aarch64}"
TARGETS=(enroll status admit serving-reaper enroll-worker)

for bin in "${TARGETS[@]}"; do
  echo "==> cargo-lambda build --release --bin $bin"
  cargo lambda build --release --bin "$bin" ${ARCH:+--arm64}
  # cargo-lambda output layout varies; copy bootstrap zip if present
  ZIP=$(find target/lambda/"$bin" -name '*.zip' 2>/dev/null | head -1 || true)
  if [[ -n "${ZIP:-}" ]]; then
    cp "$ZIP" "$OUT/$bin.zip"
  elif [[ -f "target/lambda/$bin/bootstrap" ]]; then
    (cd "target/lambda/$bin" && zip -q "$OUT/$bin.zip" bootstrap)
  else
    echo "WARN: no artifact for $bin"
  fi
done

if [[ -d crates/admin-api ]]; then
  echo "==> cargo-lambda build admin-api"
  cargo lambda build --release --bin admin-api ${ARCH:+--arm64} || true
  if [[ -f target/lambda/admin-api/bootstrap ]]; then
    (cd target/lambda/admin-api && zip -q "$OUT/admin-api.zip" bootstrap)
  fi
fi

echo "Lambda assets in $OUT"
ls -la "$OUT" || true
