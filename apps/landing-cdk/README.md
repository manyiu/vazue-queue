# Product website CDK (`queue.vazue.com`)

Private stack: **S3 + CloudFront (OAC) + ACM (us-east-1) + Route 53** alias for
`queue.vazue.com`. Hosts the unified marketing + documentation site (`apps/website`).

## Prerequisites

1. AWS credentials with permission for S3, CloudFront, ACM, Route 53, IAM
2. Route 53 **public hosted zone** for `vazue.com` in the same account
3. CDK bootstrap in **us-east-1** (CloudFront certs must be there)

```bash
aws sso login   # or your usual auth
npx cdk bootstrap aws://ACCOUNT/us-east-1
```

## Deploy

From the monorepo root:

```bash
pnpm install
pnpm --filter @vazue/landing-cdk deploy
```

That runs `pnpm website:build` then deploys stack `VazueQueueLanding`.

Optional context / env:

| Key | Default | Notes |
|-----|---------|--------|
| `domainName` | `queue.vazue.com` | CloudFront alternate domain |
| `hostedZoneName` | `vazue.com` | Zone to validate ACM + create aliases |
| `hostedZoneId` / `HOSTED_ZONE_ID` | *(lookup)* | Set to skip Route 53 lookup at synth |

Stack defaults to **retaining** the S3 bucket on destroy (production-safe). Pass `ephemeral: true` only for throwaway stacks.

```bash
HOSTED_ZONE_ID=Zxxxxxxxxxxxx pnpm --filter @vazue/landing-cdk deploy
# or
pnpm --filter @vazue/landing-cdk exec cdk deploy -c hostedZoneId=Zxxxxxxxxxxxx
```

## After deploy

1. Open **SiteUrl** output → `https://queue.vazue.com`
2. First ACM DNS validation can take a few minutes
3. Redeploy after landing content changes (same command)

## Destroy

```bash
pnpm --filter @vazue/landing-cdk destroy
```
