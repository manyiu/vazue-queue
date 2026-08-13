# AGENTS.md

Guidance for AI agents and humans working in this monorepo.

## Product

Vazue Queue is an OSS-first virtual waiting room on AWS. Publish only OSS packages to npm (`@vazue/queue-cdk`, `create-vazue-queue`, `@vazue/queue-sdk`). `packages/saas/` is commercial and must not be published.

## Defaults

- Default AWS region for examples: **us-east-1**
- SaaS boundary: same monorepo; **only OSS packages** publish to npm (enforced by `scripts/check-publish-boundary.sh`)
- Admit token is returned on **GET status** when the visitor is admitted (optional separate admit path for edge cases)
- Both data and control planes use **API Gateway HTTP API**
- Bot protection default: **off**

## Commands

```bash
pnpm install
pnpm test:local    # mandatory before PR / deploy
pnpm verify        # alias for agent stop condition
docker compose -f docker-compose.local.yml up -d
cargo run -p queue-api --bin local-server
# queue :3000 + admin :3001 (shared in-memory events)
```

## Package boundaries

| Path | Role | Publish |
|------|------|---------|
| `packages/core-rust` | queue-kernel, queue-api, admin-api, platform | No (binaries via CDK) |
| `packages/cdk` | `@vazue/queue-cdk` | Yes |
| `packages/create-vazue-queue` | Scaffold + CLI wizard | Yes |
| `packages/sdk-typescript` | `@vazue/queue-sdk` | Yes |
| `packages/saas` | Stripe, plan-limits, SaaS CDK | **Never npm** |

## Stop condition

Work is done only when:

```bash
pnpm verify
```
