# Vazue Queue

OSS-first virtual waiting room on AWS — Queue-it-style fairness with serverless cost profile.

## Quick start

```bash
npx create-vazue-queue my-queue
cd my-queue
pnpm install && npx cdk bootstrap && npm run deploy
```

Or develop in this monorepo:

```bash
pnpm install
docker compose -f docker-compose.local.yml up -d
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
pnpm --filter @vazue/waiting-room dev
```

## Packages (npm)

| Package | Description |
|---------|-------------|
| `@vazue/queue-cdk` | Deploy the stack |
| `create-vazue-queue` | Scaffold + config wizard |
| `@vazue/queue-sdk` | TypeScript client |
| `@vazue/queue-edge-cloudfront` | Lambda@Edge connector |

`packages/saas/` is commercial and **not** published.

## License

Apache-2.0 for published OSS packages. See `packages/saas/NOTICE.md` for SaaS boundary.

## Default region

`us-east-1`
