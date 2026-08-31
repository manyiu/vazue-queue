# Vazue Queue

[![CI](https://github.com/manyiu/vazue-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/manyiu/vazue-queue/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/create-vazue-queue.svg)](https://www.npmjs.com/package/create-vazue-queue)
[![License](https://img.shields.io/github/license/manyiu/vazue-queue.svg)](https://github.com/manyiu/vazue-queue/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-queue.vazue.com-blue)](https://queue.vazue.com/docs)

> Open source virtual waiting room for AWS. Deploy with CDK, protect origins with admit tokens, and pay serverless rates instead of per-visitor SaaS markup.

**[Website](https://queue.vazue.com)** · **[Docs](https://queue.vazue.com/docs)** · **[GitHub](https://github.com/manyiu/vazue-queue)**

## What it is

Vazue Queue is a **virtual waiting room** for AWS — Queue-it-style fairness with a serverless cost profile. Visitors **enroll → poll status → receive an admit JWT → redirect to the protected origin**, which verifies the token.

- **Is:** Fair FIFO admission for flash events (ticket drops, product launches, invite-only sales)
- **Is not:** A job queue (SQS, Bull, RabbitMQ)
- **For:** AWS teams who want operator-owned infrastructure and Apache-2.0 auditability
- **Not for:** Non-AWS stacks or zero-ops requirements

See [Why Vazue Queue?](https://queue.vazue.com/docs/introduction/why-vazue) for comparison with SaaS waiting rooms and DIY queues.

## Features

- **Fair FIFO** — Atomic position assignment and serving counter; refreshing does not skip the line
- **Full stack** — Waiting room UI, queue API, admin portal, and optional Lambda@Edge gate
- **Published load tests** — In-region benchmarks with formulas; capacity governed by AWS quotas, not a product ceiling
- **Apache-2.0, operator-owned** — Auditable source; data stays in your AWS account

## Presets

| Preset | Includes |
|--------|----------|
| `minimal` | API Gateway + Lambda + DynamoDB |
| `standard` | + CloudFront waiting room (**recommended**) |
| `full` | + admin portal, WAF, Lambda@Edge connector |

## Quick start

### Prerequisites

- AWS account, **Node.js 24+**, AWS CLI, CDK bootstrap in **us-east-1**, DNS for queue domain
- **Not required:** Cloudflare (uses AWS CloudFront); bot protection defaults **off**

### Deploy

```bash
npx create-vazue-queue my-queue
cd my-queue
pnpm install && npx cdk bootstrap && npm run deploy
```

Non-interactive:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

Reconfigure:

```bash
npx vazue-queue config
npx vazue-queue config --validate
```

Cost estimate:

```bash
npx vazue-queue cost --visitors 100000 --minutes 60
```

## How it works

1. Visitor enrolls → gets queue position
2. Waiting room polls `GET /status` until admitted
3. Redirect with `?vazue_token=` → origin verifies JWT via SDK

See [Visitor flow](https://queue.vazue.com/docs/concepts/visitor-flow) for the full sequence diagram.

## SDK integration

```ts
import { QueueClient, extractAdmitToken, verifyAdmitToken } from '@yiu/queue-sdk';

// Waiting room
const client = new QueueClient({ baseUrl: 'https://queue.example.com' });
const { request_id } = await client.enroll('my-event', {
  return_url: 'https://shop.example.com/checkout',
});
const status = await client.waitUntilAdmitted('my-event', request_id);
// Redirect with status.admit_token as ?vazue_token=

// Origin verification
const token = extractAdmitToken({
  cookieHeader: req.headers.cookie,
  query: new URLSearchParams(req.url.split('?')[1] ?? ''),
});
const claims = token ? verifyAdmitToken(token, process.env.VAZUE_JWT_SECRET!) : null;
```

Use the same secret as `security.jwtHmacSecret` in your CDK config. Full reference: [SDK docs](https://queue.vazue.com/docs/reference/sdks).

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `create-vazue-queue` | 1.0.2 | Scaffold + config wizard + cost CLI |
| `@yiu/queue-cdk` | 1.0.4 | CDK constructs to deploy the stack |
| `@yiu/queue-sdk` | 1.0.1 | TypeScript client (Node 20+) |
| `github.com/vazue/queue-go` | — | Go client — `go get github.com/vazue/queue-go` |
| `io.vazue:queue-sdk` | — | Java 11+ client (Maven) |
| `@vazue/queue-edge-cloudfront` | — | Lambda@Edge connector (private; vendored via CDK) |

Product website source: `apps/website` (deployed to `queue.vazue.com`).

## Local development

Develop in this monorepo:

```bash
pnpm install
docker compose -f docker-compose.local.yml up -d   # optional DynamoDB Local
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
# queue :3000 + admin :3001 (ADMIN_DEV_AUTH=1)
pnpm --filter @vazue/waiting-room dev
pnpm website:dev   # product site + docs at http://localhost:5190
bash scripts/sdk-smoke.sh   # SDK smoke test against local-server
```

Go/Java SDK tests locally: `bash scripts/sdk-go-test.sh`, `bash scripts/sdk-java-test.sh`.

## Documentation

| Topic | URL |
|-------|-----|
| Docs home | [queue.vazue.com/docs](https://queue.vazue.com/docs) |
| Why Vazue Queue | [queue.vazue.com/docs/introduction/why-vazue](https://queue.vazue.com/docs/introduction/why-vazue) |
| Self-host (open source) | [queue.vazue.com/oss](https://queue.vazue.com/oss) |
| Deploy (CDK) | [queue.vazue.com/docs/guides/deploy](https://queue.vazue.com/docs/guides/deploy) |
| Cost | [queue.vazue.com/docs/guides/cost](https://queue.vazue.com/docs/guides/cost) |
| Capacity / performance | [queue.vazue.com/docs/guides/capacity](https://queue.vazue.com/docs/guides/capacity) |
| Operations | [queue.vazue.com/docs/guides/operations](https://queue.vazue.com/docs/guides/operations) |
| Architecture | [queue.vazue.com/docs/concepts/architecture](https://queue.vazue.com/docs/concepts/architecture) |
| SDK compatibility | [docs/sdks/compatibility.md](docs/sdks/compatibility.md) |
| Deploy runbook | [docs/deploy/oss-cdk.md](docs/deploy/oss-cdk.md) |
| Examples | [examples/](examples/) (self-hosted, with-existing-cloudfront, load tests) |
| Lambda@Edge on existing CloudFront | [examples/with-existing-cloudfront](examples/with-existing-cloudfront) |
| OSS v1 launch checklist | [docs/launch/oss-v1.md](docs/launch/oss-v1.md) |

## Capacity

Vazue Queue has **no fixed visitor ceiling** — scale is bounded by AWS service quotas in your account.

| Workload | Baseline on default AWS quotas | Notes |
|----------|-------------------------------|-------|
| **Concurrent status pollers** | ~10,000 (in-region, RC SLOs) | Pollers sleep between polls, so ~10K visitors typically use far fewer than 10K concurrent Lambdas; **`standard` preset may do better** thanks to CloudFront status caching |
| **Simultaneous unique enrolls** | ~1,000 (reference load tests) | A flash of ~1K enrolls can approach Lambda's default **1,000 concurrent-execution quota per Region** — **account-wide across all functions**, not a Vazue limit |

Lambda's concurrency quota is **adjustable** (default 1,000/Region; can be raised to tens of thousands). Request a **quota increase** in [AWS Service Quotas](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html) (opens a support case). Check your limit: `aws lambda get-account-settings` → `AccountLimit.ConcurrentExecutions`. See [Lambda concurrency quotas](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html). **New AWS accounts** may start below 1,000 until usage history builds ([Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)).

Load tests are **in-region**; global client RTT is not fully modeled. Enroll burst and status polling are tested separately — see [`docs/deploy/capacity.md`](docs/deploy/capacity.md).

100K visitors × 60 min ≈ **$33–$197** depending on poll interval — see [Cost guide](https://queue.vazue.com/docs/guides/cost).

See [`docs/deploy/capacity.md`](docs/deploy/capacity.md) for validated numbers, estimation formulas, and limits vs real deployments.

## Contributing

```bash
pnpm verify   # required before PR
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md) or **security@vazue.com**.

## License

Apache-2.0 for published open source packages.

## Default region

`us-east-1`
