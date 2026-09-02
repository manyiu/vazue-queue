# AGENTS.md

Guidance for AI agents and humans working in this monorepo.

## Product

Vazue Queue is an open source virtual waiting room on AWS. Publish only OSS packages to npm (`@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk`).

## Defaults

- Default AWS region for examples: **us-east-1**
- **Only OSS packages** publish to npm (enforced by `scripts/check-publish-boundary.sh`)
- Admit token is returned on **GET status** when the visitor is admitted (optional separate admit path for edge cases)
- Both data and control planes use **API Gateway HTTP API**
- Bot protection default: **off**

## Toolchains: Docker local, native in GitHub Actions

| Concern | Local | GitHub Actions |
|---------|-------|----------------|
| Node / pnpm / Rust | Native (or as you prefer) | `setup-node`, `dtolnay/rust-toolchain` |
| Go / Java SDK tests | `bash scripts/sdk-*-test.sh` (Docker) if Go/JDK not installed | `actions/setup-go`, `actions/setup-java` — **never** Docker for these |
| OpenAPI Generator stubs | `bash scripts/generate-sdks.sh` (Docker) | Same script (generator image only) |
| DynamoDB Local | `docker compose -f docker-compose.local.yml up -d` + `bash scripts/bootstrap-dynamodb-local.sh` | Not required for `local-server` (in-memory default) |

`scripts/verify.sh` refuses Docker fallbacks when `GITHUB_ACTIONS=true`.

## Commands

```bash
pnpm install
pnpm test:local    # mandatory before PR / deploy
pnpm verify        # alias for agent stop condition
docker compose -f docker-compose.local.yml up -d
bash scripts/bootstrap-dynamodb-local.sh   # optional; for VAZUE_USE_DYNAMODB=1
cargo run -p queue-api --bin local-server
# queue :3000 + admin :3001 (in-memory default; ADMIN_DEV_AUTH=1)
# DynamoDB Local: bash scripts/local-with-dynamodb.sh
pnpm website:dev               # product site + docs (http://localhost:5190)
pnpm website:build             # build for landing-cdk deploy
pnpm website:preview           # preview production build (http://127.0.0.1:5200)
bash scripts/sdk-go-test.sh    # Docker Go tests
bash scripts/sdk-java-test.sh  # Docker Java tests
npx vazue-queue cost --visitors 100000 --minutes 60
```

## Package boundaries

| Path | Role | Publish |
|------|------|---------|
| `packages/core-rust` | queue-kernel, queue-api, admin-api, platform | No (binaries via CDK) |
| `packages/cdk` | `@yiu/queue-cdk` | Yes |
| `packages/create-vazue-queue` | Scaffold + CLI wizard | Yes |
| `packages/sdk-typescript` | `@yiu/queue-sdk` | Yes |
| `packages/sdk-go` | Go client | Go module (not npm) |
| `packages/sdk-java` | Java client | Maven (not npm) |

## Stop condition

Work is done only when:

```bash
pnpm verify
```
