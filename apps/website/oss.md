# Self-host on AWS

Deploy a complete virtual waiting room into a **dedicated AWS account**. Apache-2.0 source, serverless pricing, no per-visitor SaaS markup.

## Prerequisites

- **AWS account** (only external platform required for a default deploy)
- Node.js 24+, AWS CLI, CDK bootstrap in `us-east-1`
- A domain (or subdomain) for the waiting room — DNS via Route 53 or another provider

**No Cloudflare account** is required. The stack uses **AWS CloudFront** for the waiting room CDN. [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) is optional and only used when bot protection challenge modes are enabled ([security](/docs/concepts/security)).

## Start here

```bash
npx create-vazue-queue my-queue
cd my-queue
pnpm install && npx cdk bootstrap && npm run deploy
```

Default region: **us-east-1**. Interactive wizard sets domain, preset, and JWT secret.

Non-interactive:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

**Cost estimate before deploy:**

```bash
npx vazue-queue cost --visitors 100000 --minutes 60
```

| Scenario | Est. AWS total (us-east-1) |
|----------|----------------------------|
| 1,000 visitors × 30 min | ~$1 |
| 10,000 × 60 min | ~$20 |
| 100,000 × 60 min | ~$197 (worst-case poll); often **~$33** with slower adaptive polling |

[Full cost guide →](/docs/guides/cost)

## What ships in the box

| Component | Technology |
|-----------|------------|
| Queue API (`/enroll`, `/status`) | API Gateway HTTP API + Rust Lambda |
| Waiting room UI | CloudFront + static assets (`standard` / `full`) |
| State & fairness | DynamoDB + queue kernel |
| Admin API + portal | Cognito + Lambda (`full` preset) |
| Origin gate | Lambda@Edge + admit JWT (`full` preset) |

[Architecture overview →](/docs/concepts/architecture)

## npm packages

| Package | Role |
|---------|------|
| [`@yiu/queue-cdk`](https://www.npmjs.com/package/@yiu/queue-cdk) | CDK constructs — deploy the stack |
| [`create-vazue-queue`](https://www.npmjs.com/package/create-vazue-queue) | Scaffold + `vazue-queue config` wizard |
| [`@yiu/queue-sdk`](https://www.npmjs.com/package/@yiu/queue-sdk) | TypeScript client + origin JWT verification |

Go ([`queue-go`](https://github.com/manyiu/vazue-queue/tree/main/packages/sdk-go)) and Java ([`queue-sdk`](https://github.com/manyiu/vazue-queue/tree/main/packages/sdk-java)) clients live in the monorepo.

## Pick a preset

| Preset | Includes | When to use |
|--------|----------|-------------|
| `minimal` | API + DynamoDB | Custom waiting room UI, smallest stack |
| `standard` | + CloudFront waiting room | **Most deployments** — UI + status edge cache |
| `full` | + admin, WAF, Lambda@Edge | Operator dashboard and origin gate required |

[Presets guide →](/docs/concepts/presets)

## Plan capacity

| Concern | Planning note |
|---------|----------------|
| Visitor ceiling | **None in software** — scale is limited by AWS quotas and preset config |
| Default-account baseline | ~10K concurrent pollers validated in-region on reference stack ([details](/docs/guides/capacity)) |
| Simultaneous unique enrolls | ~1K on `standard` + buffer (reference SLO) |
| Idle between events | Near-zero serverless cost |

[Capacity planning →](/docs/guides/capacity)

## Why self-host instead of SaaS?

- **AWS bill only** — no per-visitor vendor fee
- **Audit the source** — [github.com/manyiu/vazue-queue](https://github.com/manyiu/vazue-queue)

[Full comparison →](/docs/introduction/why-vazue)

## License

Apache-2.0 for published open source packages.

## Next steps

- [Quickstart](/docs/getting-started/quickstart)
- [Deploy with CDK](/docs/guides/deploy)
- [SDK examples](/docs/reference/sdks)
- [Local development](/docs/getting-started/local-development)
