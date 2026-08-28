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

- Deploy runbook: [`docs/deploy/oss-cdk.md`](https://github.com/manyiu/vazue-queue/blob/main/docs/deploy/oss-cdk.md)
- Config schema: `config-schema.json` (also written by `create-vazue-queue`)

## Capacity

See [`docs/deploy/capacity.md`](https://github.com/manyiu/vazue-queue/blob/main/docs/deploy/capacity.md) — validated **~10K concurrent pollers** in-region; formulas for estimating origin load vs poll interval.

## License

Apache-2.0
