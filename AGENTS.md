# AGENTS.md

Guidance for AI agents and humans working in this monorepo.

## Product

Vazue Queue is an OSS-first virtual waiting room on AWS. Publish only OSS packages to npm (`@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk`). `packages/saas/` is commercial and must not be published.

## Defaults

- Default AWS region for examples: **us-east-1**
- SaaS boundary: same monorepo; **only OSS packages** publish to npm (enforced by `scripts/check-publish-boundary.sh`)
- Admit token is returned on **GET status** when the visitor is admitted (optional separate admit path for edge cases)
- Both data and control planes use **API Gateway HTTP API**
- Bot protection default: **off**

## Toolchains: Docker local, native in GitHub Actions

| Concern | Local | GitHub Actions |
|---------|-------|----------------|
| Node / pnpm / Rust | Native (or as you prefer) | `setup-node`, `dtolnay/rust-toolchain` |
| Go / Java SDK tests | `bash scripts/sdk-*-test.sh` (Docker) if Go/JDK not installed | `actions/setup-go`, `actions/setup-java` — **never** Docker for these |
| OpenAPI Generator stubs | `bash scripts/generate-sdks.sh` (Docker) | Same script (generator image only) |
| DynamoDB Local | `docker compose -f docker-compose.local.yml up -d` | Not required for `local-server` (in-memory) |

`scripts/verify.sh` refuses Docker fallbacks when `GITHUB_ACTIONS=true`.

## Commands

```bash
pnpm install
pnpm test:local    # mandatory before PR / deploy
pnpm verify        # alias for agent stop condition
docker compose -f docker-compose.local.yml up -d
cargo run -p queue-api --bin local-server
# queue :3000 + admin :3001 (shared in-memory events; ADMIN_DEV_AUTH=1)
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
| `packages/saas` | Stripe, plan-limits, SaaS CDK | **Never npm** |

## Stop condition

Work is done only when:

```bash
pnpm verify
```
