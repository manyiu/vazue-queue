#!/usr/bin/env bash
# Run packages/sdk-java tests in Docker (no local JDK/Maven).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${VAZUE_JAVA_IMAGE:-maven:3.9.9-eclipse-temurin-11}"
docker run --rm \
  -v "$ROOT/packages/sdk-java:/src" \
  -v vazue-maven-cache:/root/.m2 \
  -w /src \
  "$IMAGE" \
  mvn -q -B test
