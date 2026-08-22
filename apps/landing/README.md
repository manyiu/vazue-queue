# Marketing landing (`queue.vazue.com`)

Static first viewport for the OSS product.

## Local

```bash
pnpm --filter @vazue/landing build
pnpm --filter @vazue/landing dev
```

## Deploy to AWS (CDK)

Use the private stack in [`../landing-cdk`](../landing-cdk): S3 + CloudFront + ACM + Route 53 for `queue.vazue.com`.

```bash
pnpm --filter @vazue/landing-cdk deploy
```

See [`../landing-cdk/README.md`](../landing-cdk/README.md).
