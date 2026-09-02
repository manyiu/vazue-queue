# Local development

Run the data plane and admin API locally without AWS.

## Prerequisites

- Node.js 24+, pnpm, Rust toolchain (for `cargo run` local-server)
- Docker — optional (DynamoDB Local; SDK tests can use Docker helpers)
- AWS CLI — only when using DynamoDB Local bootstrap (`scripts/bootstrap-dynamodb-local.sh`)

No AWS account or Cloudflare account is needed for local API and waiting-room development.

## Local testing cheat sheet

| Step | When | Command |
|------|------|---------|
| 1. Pre-PR gate | Every change | `pnpm verify` or `pnpm test:local` |
| 2. API iteration | Feature work | `cargo run -p queue-api --bin local-server` (see below) |
| 3. UI | Waiting room / admin | See [Waiting room UI](#waiting-room-ui) and [Admin portal](#admin-portal) |
| 4. SDK contract | After API changes | `bash scripts/sdk-smoke.sh` |
| 5. k6 script sanity | Optional | `PROFILE=smoke bash scripts/load-test-100k.sh` |
| 6. CDK / IAM | Infra changes | `pnpm --filter @yiu/queue-cdk test` |
| 7. Lambda packaging | Before deploy | `REQUIRE_ARTIFACTS=1 scripts/build-lambda-assets.sh` |
| 8. AWS smoke | Release / risky deploy | `bash scripts/deploy-smoke-standard.sh` |

**Optional — DynamoDB Local:** exercise `DynamoDbStore` (shard counters, visitor writes) without AWS:

```bash
bash scripts/local-with-dynamodb.sh
# or: docker compose up + bootstrap + VAZUE_USE_DYNAMODB=1 cargo run ...
bash scripts/test-dynamodb-local.sh   # smoke enroll/status against DDB Local
```

**Not covered locally:** API Gateway edge behavior, CloudFront status caching, Cognito admin JWT (use `ADMIN_DEV_AUTH=1`), SQS buffered enroll (`ENROLL_VIA_SQS`), Lambda concurrency quotas, WAF / Lambda@Edge. Use [deploy smoke](#pre-deploy-aws-smoke) or a dev stack for those.

## Dual API server (default: in-memory)

```bash
pnpm install
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
```

- Queue API: `http://localhost:3000`
- Admin API: `http://localhost:3001`
- Sets `VAZUE_LOCAL=1` and `ADMIN_DEV_AUTH=1` (admin Bearer checks skipped)
- Uses **in-memory** stores (fast; no Docker required)

## DynamoDB Local (optional)

Same HTTP surface as production Lambdas, backed by **DynamoDB Local** and `DynamoDbStore` / `DynamoDbAdminStore`:

```bash
bash scripts/local-with-dynamodb.sh
```

Manual steps:

```bash
docker compose -f docker-compose.local.yml up -d
bash scripts/bootstrap-dynamodb-local.sh
export VAZUE_USE_DYNAMODB=1
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
```

Sets `AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8000` and table names (`Events`, `Visitors`, `Counters`, `Rooms`) when unset.

## Waiting room UI

```bash
pnpm --filter @vazue/waiting-room dev
```

## Admin portal

```bash
NEXT_PUBLIC_ADMIN_DEV_AUTH=1 pnpm --filter @vazue/admin-portal dev
```

Runs on port **5174**. Deployed admin loads Cognito + API URLs from `/config.js`.

To exercise JWT checks locally: unset dev flags and set `ADMIN_REQUIRE_JWT=1`.

## Monorepo verify

```bash
pnpm verify
```

Runs Rust tests, CDK tests, SDK tests, website build, and package checks. `pnpm test:local` is a faster subset (unit + spawns in-memory `local-server` + API/SDK smoke).

## SDK smoke test

With `local-server` running:

```bash
bash scripts/sdk-smoke.sh
```

Enrolls against the `demo` event, receives an admit token, and verifies it with each SDK. See [SDK reference](/docs/reference/sdks).

## Pre-deploy AWS smoke

Ephemeral **standard** preset in us-east-1 (deploy → seed event → contract smoke → destroy):

```bash
bash scripts/deploy-smoke-standard.sh
# SKIP_DESTROY=1  — leave stack up
# SKIP_DEPLOY=1   — smoke an existing stack
```

In-region load tests (Lambda + DynamoDB + CloudFront): see [Deploy with CDK — Load test](/docs/guides/deploy#load-test).

## Website (this site)

```bash
pnpm website:dev
```

## Next steps

- [Architecture](/docs/concepts/architecture)
- [Deploy with CDK](/docs/guides/deploy)
