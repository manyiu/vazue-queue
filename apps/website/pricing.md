# Pricing

Deploy to a **dedicated AWS account** with [`@yiu/queue-cdk`](/oss). Billing goes directly to AWS — serverless components charge mainly during flash events, not per visitor to a vendor.

### Estimate before deploy

```bash
npx vazue-queue cost --visitors 100000 --minutes 60 --poll 5
```

| Scenario (us-east-1, CLI model) | Est. AWS total |
|---------------------------------|----------------|
| 1,000 visitors × 30 min wait | **~$1** |
| 10,000 visitors × 60 min | **~$20** |
| 100,000 visitors × 60 min (5 s poll) | **~$197** |
| 100,000 visitors × 60 min (30 s avg poll) | **~$33** |

The CLI assumes every visitor polls for the full wait window. Adaptive polling and CloudFront status caching usually **lower** real spend. See the full breakdown: **[AWS cost estimate](/docs/guides/cost)**.

### What is billed

| Line item | Typical share (large event) |
|-----------|----------------------------|
| API Gateway + CloudFront | ~70% (HTTP requests) |
| DynamoDB | ~18% (enroll writes + status reads) |
| Lambda | ~9% |
| SQS, idle storage | &lt;2% |

Between events, compute is **near-zero** — no always-on servers. Fixed add-ons on `full` preset (WAF, Cognito, Secrets Manager) are a few dollars per month.

Apache-2.0 — audit the [source on GitHub](https://github.com/manyiu/vazue-queue).

See **[Why Vazue Queue](/docs/introduction/why-vazue)** for comparison with other waiting room options.

[AWS cost guide →](/docs/guides/cost) · [Open source self-host →](/oss) · [Documentation →](/docs/)
