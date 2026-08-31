# Vazue Queue

Open source-first virtual waiting room on AWS — Queue-it-style fairness with serverless cost profile.

**Documentation:** [queue.vazue.com/docs](https://queue.vazue.com/docs)

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
pnpm website:dev   # product site + docs locally
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

Product website source: `apps/website` (deployed to `queue.vazue.com`).

## Documentation

| Topic | URL |
|-------|-----|
| Docs home | [queue.vazue.com/docs](https://queue.vazue.com/docs) |
| Self-host (open source) | [queue.vazue.com/oss](https://queue.vazue.com/oss) |
| Deploy (CDK) | [queue.vazue.com/docs/guides/deploy](https://queue.vazue.com/docs/guides/deploy) |
| Capacity / performance | [queue.vazue.com/docs/guides/capacity](https://queue.vazue.com/docs/guides/capacity) |
| Architecture | [queue.vazue.com/docs/concepts/architecture](https://queue.vazue.com/docs/concepts/architecture) |
| SDK compatibility | [docs/sdks/compatibility.md](docs/sdks/compatibility.md) |
| Lambda@Edge on existing CloudFront | [examples/with-existing-cloudfront](examples/with-existing-cloudfront) |
| OSS v1 launch checklist | [docs/launch/oss-v1.md](docs/launch/oss-v1.md) |

## Capacity

Plan for **~10,000 concurrent status pollers** (in-region, RC SLOs) on a default data plane. Status polling matches the waiting room; **`standard` preset may do better** thanks to CloudFront status caching. Load tests do not fully model enroll bursts or global client RTT.

See [`docs/deploy/capacity.md`](docs/deploy/capacity.md) for validated numbers, estimation formulas, and limits vs real deployments.

## License

Apache-2.0 for published open source packages.

## Default region

`us-east-1`
