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
| `@yiu/queue-cdk` | Deploy the stack |
| `create-vazue-queue` | Scaffold + config wizard |
| `@yiu/queue-sdk` | TypeScript client |
| `github.com/vazue/queue-go` | Go client (local Docker: `scripts/sdk-go-test.sh`; CI: native Go) |
| `io.vazue:queue-sdk` | Java 11+ client (local Docker: `scripts/sdk-java-test.sh`; CI: native Maven) |
| `@vazue/queue-edge-cloudfront` | Lambda@Edge connector (private; vendored via CDK) |

Marketing landing source: `apps/landing` (target host `queue.vazue.com`).

## Documentation

| Topic | Path |
|-------|------|
| Deploy (CDK) | [`docs/deploy/oss-cdk.md`](docs/deploy/oss-cdk.md) |
| Capacity / performance | [`docs/deploy/capacity.md`](docs/deploy/capacity.md) |
| OSS v1 launch checklist | [`docs/launch/oss-v1.md`](docs/launch/oss-v1.md) |
| SDK compatibility (Go/Java CI vs Docker) | [`docs/sdks/compatibility.md`](docs/sdks/compatibility.md) |
| Lambda@Edge on existing CloudFront | [`examples/with-existing-cloudfront`](examples/with-existing-cloudfront) |

## Capacity

Plan for **~10,000 concurrent status pollers** (in-region, RC SLOs) on a default data plane. Status polling matches the waiting room; **`standard` preset may do better** thanks to CloudFront status caching. Load tests do not fully model enroll bursts or global client RTT.

See [`docs/deploy/capacity.md`](docs/deploy/capacity.md) for validated numbers, estimation formulas, and limits vs real deployments.

`packages/saas/` is commercial and **not** published.

## License

Apache-2.0 for published OSS packages. See `packages/saas/NOTICE.md` for SaaS boundary.

## Default region

`us-east-1`
