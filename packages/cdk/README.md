# @yiu/queue-cdk

CDK constructs for [Vazue Queue](https://github.com/manyiu/vazue-queue) — an OSS virtual waiting room on AWS.

## Quick start

```bash
npx create-vazue-queue my-queue
cd my-queue
pnpm install && npx cdk bootstrap && npm run deploy
```

Or use `VazueQueue` / `VazueQueueApp` directly in your CDK app — see `examples/` in the monorepo.

## Presets

| Preset | Includes |
|--------|----------|
| `minimal` | API Gateway + Lambda + DynamoDB |
| `standard` | + CloudFront waiting room |
| `full` | + admin portal, WAF, Lambda@Edge connector |

## Docs

- Website: [queue.vazue.com/docs](https://queue.vazue.com/docs)
- Deploy runbook: [queue.vazue.com/docs/guides/deploy](https://queue.vazue.com/docs/guides/deploy)
- Config schema: `config-schema.json` (also written by `create-vazue-queue`)

## Capacity

See [Capacity planning](https://queue.vazue.com/docs/guides/capacity) — validated **~10K concurrent pollers** and **~1K simultaneous enrolls** on default AWS quotas (in-region); enroll bursts can approach Lambda's 1,000 concurrent-execution quota per Region.

## License

Apache-2.0
