#!/usr/bin/env bash
# Build Rust Lambda zips into packages/cdk/assets/lambda/ for @vazue/queue-cdk.
# Set REQUIRE_ARTIFACTS=1 to fail if any expected zip is missing (CI release path).
# On macOS/non-Linux hosts, arm64 Lambda builds need zig (`brew install zig`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/packages/cdk/assets/lambda"
mkdir -p "$OUT"
REQUIRE_ARTIFACTS="${REQUIRE_ARTIFACTS:-0}"
TARGETS=(enroll status admit serving-reaper enroll-worker admin-api)

if ! command -v cargo-lambda >/dev/null 2>&1; then
  echo "cargo-lambda not installed (pip install cargo-lambda / cargo install cargo-lambda)"
  if [[ "$REQUIRE_ARTIFACTS" == "1" ]]; then
    echo "ERROR: REQUIRE_ARTIFACTS=1 but cargo-lambda is missing"
    exit 1
  fi
  for bin in "${TARGETS[@]}"; do
    echo "stub" > "$OUT/$bin.MISSING"
  done
  exit 0
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required to package bootstrap binaries"
  exit 1
fi

# cargo-lambda --arm64 cross-compiles to aarch64-unknown-linux-gnu via zig on non-Linux.
NEED_ZIG=0
if [[ "$(uname -s)" != "Linux" ]] || [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != "arm64" ]]; then
  NEED_ZIG=1
fi
if [[ "$NEED_ZIG" == "1" ]] && ! command -v zig >/dev/null 2>&1; then
  echo "zig not found — required to cross-compile arm64 Lambda binaries on this host"
  echo "Install: brew install zig   (or https://ziglang.org)"
  if [[ "$REQUIRE_ARTIFACTS" == "1" ]]; then
    echo "ERROR: REQUIRE_ARTIFACTS=1 but zig is missing"
    exit 1
  fi
  for bin in "${TARGETS[@]}"; do
    echo "zig-missing" > "$OUT/$bin.MISSING"
  done
  exit 0
fi

cd "$ROOT/packages/core-rust"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/packages/core-rust/target}"

# Prefer arm64 Linux for Lambda; cargo-lambda --arm64 uses zig cross-compile when needed.
BUILD_FLAGS=(--release --arm64)

copy_bin() {
  local bin="$1"
  local zip_out="$OUT/$bin.zip"
  rm -f "$zip_out" "$OUT/$bin.MISSING"
  local found
  found=$(find "$CARGO_TARGET_DIR/lambda/$bin" -name '*.zip' 2>/dev/null | head -1 || true)
  if [[ -n "${found:-}" ]]; then
    cp "$found" "$zip_out"
    echo "OK $bin <- $found"
    return 0
  fi
  if [[ -f "$CARGO_TARGET_DIR/lambda/$bin/bootstrap" ]]; then
    (cd "$CARGO_TARGET_DIR/lambda/$bin" && zip -q "$zip_out" bootstrap)
    echo "OK $bin <- bootstrap zip"
    return 0
  fi
  echo "MISSING $bin"
  echo "missing" > "$OUT/$bin.MISSING"
  return 1
}

failed=0
for bin in "${TARGETS[@]}"; do
  echo "==> cargo lambda build ${BUILD_FLAGS[*]} --bin $bin"
  if cargo lambda build "${BUILD_FLAGS[@]}" --bin "$bin"; then
    copy_bin "$bin" || failed=1
  else
    echo "WARN: build failed for $bin"
    echo "build-failed" > "$OUT/$bin.MISSING"
    failed=1
  fi
done

echo "Lambda assets in $OUT"
ls -la "$OUT" || true

if [[ "$REQUIRE_ARTIFACTS" == "1" && "$failed" -ne 0 ]]; then
  echo "ERROR: one or more Lambda artifacts missing (REQUIRE_ARTIFACTS=1)"
  exit 1
fi
