# Attach Lambda@Edge to an existing CloudFront distribution

Use this when you already have CloudFront in front of checkout and only need Vazue's
**viewer-request** admit-token gate — not a second “protected origin” distribution.

## Prerequisites

- Stack **region = us-east-1** (Lambda@Edge requirement)
- Shared HS256 secret: same value in `security.jwtHmacSecret` and your data-plane signing secret
- Built edge asset: `bash scripts/build-edge-connector.sh`

## Deploy this example

```bash
cd examples/with-existing-cloudfront
pnpm install
export VAZUE_JWT_HMAC_SECRET='replace-with-a-long-random-secret'
npx cdk synth   # or: pnpm synth
# npx cdk deploy
```

The app deploys:

1. `VazueQueue` (`standard` + `edgeConnector`) — waiting room + edge function with baked config
2. A stand-in “existing shop” CloudFront that associates `queue.edgeProtect.edgeVersion` as **viewer-request**

## Wire into your real distribution

```ts
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { VazueQueue } from '@vazue/queue-cdk';

const queue = new VazueQueue(this, 'Queue', {
  domainName: 'queue.example.com',
  preset: 'standard',
  features: { edgeConnector: true },
  security: { jwtHmacSecret: secret },
});

// In your existing Distribution defaultBehavior (or additionalBehaviors):
edgeLambdas: [
  {
    functionVersion: queue.edgeProtect!.edgeVersion!,
    eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
  },
],
```

Outputs `EdgeProtectVersionArn` if you associate via Console / CLI instead of CDK.

## Behavior

| Request | Result |
|---------|--------|
| Public paths (`/health`, `/ready`, `/favicon.ico`) | Pass through |
| Valid `vazue_token` cookie or `?vazue_token=` | Pass through |
| Otherwise | `302` → `https://queue.example.com?returnUrl=…` |

After admit, the waiting room redirects to `returnUrl` and appends `vazue_token`. Your origin (or this edge gate) must verify the token with the same HS256 secret — see `@vazue/queue-sdk` `verifyAdmitToken`.

## Prefer a greenfield origin gate?

Set `origin.domainName` + `jwtHmacSecret` on `full` / `edgeConnector` and let CDK create the protected distribution for you (`docs/deploy/oss-cdk.md`).
