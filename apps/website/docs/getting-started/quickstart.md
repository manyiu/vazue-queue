# Quickstart

Deploy a virtual waiting room to an AWS account in a few commands. Total time: **~10–30 minutes** including CDK bootstrap (first time only).

::: info Evaluating options?
See [Why Vazue Queue](/docs/introduction/why-vazue) for comparison with SaaS waiting rooms and DIY queues.
:::

## Prerequisites

**Required**

| Requirement | Notes |
|-------------|-------|
| **AWS account** | Deploy target for all presets (`minimal`, `standard`, `full`) |
| **Node.js 24+** and pnpm or npm | CDK wizard and deploy |
| **AWS CLI** configured | `aws sso login` or access keys |
| **CDK bootstrap** in **us-east-1** | One-time per account/region: `npx cdk bootstrap` |
| **DNS for the queue domain** | Route 53 hosted zone or external DNS pointing at CloudFront |

**Not required**

| Often assumed | Actual |
|---------------|--------|
| **Cloudflare account** | **No.** The waiting room uses **Amazon CloudFront** (AWS CDN), not Cloudflare. |
| **Cloudflare Turnstile** | **No** by default. Bot protection mode is **`off`**. Turnstile is only needed when enabling `challenge_suspicious` or `challenge_always` — see [Bot protection](/docs/guides/deploy#bot-protection-turnstile). |
| **Separate SaaS waiting room** | Self-contained stack in the AWS account |

::: tip CloudFront ≠ Cloudflare
**CloudFront** = AWS content delivery (included in `standard` / `full` presets).  
**Cloudflare** = optional third-party CAPTCHA (Turnstile) only if bot challenges are enabled.
:::

## Deploy

```bash
npx create-vazue-queue my-queue
cd my-queue
pnpm install
npx cdk bootstrap
npm run deploy
```

Non-interactive:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

## Reconfigure

```bash
npx vazue-queue config
npx vazue-queue config --validate
```

## Cost estimate

Model AWS spend before deploy:

```bash
npx vazue-queue cost --visitors 100000 --minutes 60 --poll 5
```

| Inputs | Meaning |
|--------|---------|
| `--visitors` | Peak unique enrolls |
| `--minutes` | Worst-case wait per visitor |
| `--poll` | Seconds between status polls (default `5`; production uses adaptive 2–30 s) |

**Example:** 100,000 visitors × 60 minutes at 5 s polling ≈ **$197** in us-east-1 (API Gateway + CloudFront dominate). Same event at 30 s average polling ≈ **$33**.

Full breakdown, formulas, idle cost, and preset extras: **[AWS cost estimate](/docs/guides/cost)**.

## What happens next

1. Visitors hit the waiting room (CloudFront + static UI on `standard` preset)
2. Browser calls `POST /enroll` then polls `GET /status`
3. When admitted, visitor receives a JWT and redirects to the origin with `?vazue_token=…`
4. The protected application verifies the token with `@yiu/queue-sdk`

See [SDKs](/docs/reference/sdks) for TypeScript, Go, and Java examples (including a local smoke test).

Read [Visitor flow](/docs/concepts/visitor-flow) for details.

## Next steps

- [Local development](/docs/getting-started/local-development)
- [Deploy guide](/docs/guides/deploy)
- [Presets](/docs/concepts/presets)
