#!/usr/bin/env bash
# Generate reference SDK stubs from openapi/vazue-queue.yaml via Docker.
# Hand-polished packages (sdk-typescript, sdk-go, sdk-java) remain the supported clients.
#
# OpenAPI Generator still struggles with OAS 3.2; we feed a temporary 3.1.0 copy
# (same document body) so generation works without a local JDK.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${VAZUE_OPENAPI_GENERATOR_IMAGE:-openapitools/openapi-generator-cli:v7.14.0}"
OUT="/local/packages/sdk-generated"
TMP_SPEC_HOST="$ROOT/packages/sdk-generated/.openapi-3.1-for-gen.yaml"
TMP_SPEC_CTR="/local/packages/sdk-generated/.openapi-3.1-for-gen.yaml"

mkdir -p "$ROOT/packages/sdk-generated"
# Downgrade only the version line for the generator; source of truth stays 3.2 in openapi/.
sed 's/^openapi: 3\.2\.0$/openapi: 3.1.0/' "$ROOT/openapi/vazue-queue.yaml" > "$TMP_SPEC_HOST"

cleanup() { rm -f "$TMP_SPEC_HOST"; }
trap cleanup EXIT

docker run --rm \
  -v "$ROOT:/local" \
  -u "$(id -u):$(id -g)" \
  "$IMAGE" generate \
  -i "$TMP_SPEC_CTR" \
  -g go \
  -o "$OUT/go" \
  --additional-properties=packageName=queueapi,withGoMod=true,enumClassPrefix=true \
  --git-user-id=vazue \
  --git-repo-id=queue-go-generated \
  --skip-validate-spec

docker run --rm \
  -v "$ROOT:/local" \
  -u "$(id -u):$(id -g)" \
  "$IMAGE" generate \
  -i "$TMP_SPEC_CTR" \
  -g java \
  -o "$OUT/java" \
  --additional-properties=groupId=io.vazue,artifactId=queue-sdk-generated,invokerPackage=io.vazue.queue.generated,apiPackage=io.vazue.queue.generated.api,modelPackage=io.vazue.queue.generated.model,dateLibrary=java8,java8=true \
  --skip-validate-spec

echo "Generated reference stubs under packages/sdk-generated/{go,java}"
echo "Prefer hand-polished packages/sdk-go and packages/sdk-java for apps."
