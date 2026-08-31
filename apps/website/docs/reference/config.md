# Configuration reference

Human-readable guide for `vazue-queue.config.json`. Machine schema: [`config-schema.json` on GitHub](https://github.com/manyiu/vazue-queue/blob/main/packages/cdk/config-schema.json).

## Required

| Field | Type | Description |
|-------|------|-------------|
| `domainName` | string | Primary hostname for waiting room / API |

## Top-level

| Field | Default | Description |
|-------|---------|-------------|
| `preset` | `standard` | `minimal` \| `standard` \| `full` |
| `awsRegion` | `us-east-1` | AWS region for stack |

## Features

| Field | Default | Description |
|-------|---------|-------------|
| `features.waitingRoom` | preset | CloudFront + S3 waiting room UI |
| `features.adminPortal` | preset | Static admin SPA |
| `features.adminApi` | preset | Control plane HTTP API |
| `features.waf` | preset | WAF rate limiting |
| `features.edgeConnector` | preset | Lambda@Edge origin gate |
| `features.enrollBuffer` | `true` | SQS async enroll (202 + worker) |
| `features.stripe` | `false` | SaaS metering (commercial) |

## Queue

| Field | Default | Description |
|-------|---------|-------------|
| `queue.defaultThroughputPerMinute` | — | Serving advancement rate |
| `queue.counterShards` | — | 1–64 counter shards |
| `queue.tokenTtlSeconds` | — | Admit JWT TTL (min 60) |
| `queue.visitorRecordTtlHours` | — | DynamoDB visitor TTL |
| `queue.lambdaMemoryMb` | — | 128, 256, 512, or 1024 |
| `queue.lambdaArchitecture` | `arm64` | `arm64` \| `x86_64` |

## Security

| Field | Description |
|-------|-------------|
| `security.botProtection.mode` | `off` (default), `rate_limit_only`, `challenge_suspicious`, `challenge_always` |
| `security.botProtection.turnstileSiteKey` | Public Turnstile site key |
| `security.botProtection.turnstileSecretArn` | Secrets Manager ARN for Turnstile secret |
| `security.jwtHmacSecret` | HS256 secret for Lambda@Edge (required with `origin.domainName`) |
| `security.corsAllowedOrigins` | Browser CORS allowlist |

## Origin (full preset)

| Field | Description |
|-------|-------------|
| `origin.domainName` | Protected origin hostname for Lambda@Edge gate |

## DNS

| Field | Default | Description |
|-------|---------|-------------|
| `dns.hostedZoneId` | — | Route 53 zone ID |
| `dns.hostedZoneName` | — | e.g. `example.com` |
| `dns.createRecords` | `true` | Create Route 53 aliases |

## Validate

```bash
npx vazue-queue config --validate
```

[Deploy guide →](/docs/guides/deploy)
