# Presets

CDK presets control which AWS resources are created. Default: **`standard`**.

| Preset | Includes | Best for |
|--------|----------|----------|
| **`minimal`** | API Gateway + Lambda + DynamoDB (+ enroll buffer) | API-only integration, custom UI, load testing |
| **`standard`** | + CloudFront waiting room | **Recommended** — production open source deploy |
| **`full`** | + admin portal/API, WAF, Lambda@Edge connector | Operators who want dashboard + origin gate |

## minimal

- Data plane only: enroll, status, admit
- No static waiting room — use a custom frontend or call APIs directly
- Lowest resource count; highest origin load per poller (no CloudFront status cache)

## standard

- Adds S3 + CloudFront for the waiting room SPA
- Status polls cached at edge (2–30s TTL, keyed by `request_id`) — **less origin load** than `minimal` tests suggest
- Recommended for most self-hosted deployments

## full

Everything in `standard`, plus:

- **Admin portal** at CloudFront URL (intended: `app.queue.vazue.com`)
- **Admin API** with Cognito JWT auth
- **WAF** rate limiting
- **Lambda@Edge** viewer-request gate on protected origin

Requires `origin.domainName` and `security.jwtHmacSecret` for the edge connector.

## Configure

```json
{
  "domainName": "queue.example.com",
  "preset": "standard"
}
```

Or via wizard:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

Feature flags in `vazue-queue.config.json` can override individual features regardless of preset.

## Cost vs complexity

| Preset | AWS bill | Ops complexity |
|--------|----------|----------------|
| minimal | Lowest | Custom visitor UI required |
| standard | Low (+ CloudFront) | Ready-made waiting room |
| full | Higher (+ Cognito, WAF, edge) | Full operator toolkit |

[Deploy guide →](/docs/guides/deploy) · [Capacity](/docs/guides/capacity)
