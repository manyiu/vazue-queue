# Operations and troubleshooting

Common issues when deploying and running Vazue Queue.

## Deploy failures

### Lambda artifacts missing

```
Landing assets not found / Lambda zip missing
```

Run before deploy:

```bash
scripts/build-lambda-assets.sh
scripts/build-waiting-room.sh    # standard/full
scripts/build-admin-portal.sh    # full
```

On macOS install **zig** (`brew install zig`) for cross-compiling Rust Lambdas.

### ACM / DNS validation pending

First deploy to a new domain can take a few minutes for ACM DNS validation. Check Route 53 for `_acm-validation` CNAME records.

### CDK bootstrap required

```bash
npx cdk bootstrap aws://ACCOUNT/us-east-1
```

CloudFront certificates must be in **us-east-1**.

## Runtime issues

### 404 on status after enroll (buffered)

Expected briefly after **202** enroll response. Worker is still writing the visitor. Keep polling.

### Visitors not advancing

- Check event `throughput_per_minute`
- Confirm serving reaper is running (EventBridge rule)
- Check admin live overrides (paused? floodgates closed?)

### Admit token rejected at origin

- JWT secret must match between data plane and the origin verifier
- Lambda@Edge uses baked `edge-config.js` — redeploy after secret rotation
- Token may have expired (`tokenTtlSeconds`)

### High latency / throttling

- Run load tests **in the same region** as the stack
- Global visitors add RTT not covered by in-region tests
- Request Lambda concurrency / API Gateway quota increases for large events
- Use **`standard` preset** for CloudFront status caching

## Health checks

```bash
curl https://your-queue-api/health
curl https://your-queue-api/ready
```

`ready` returns `deployment` profile and `tenantId`.

## Load testing

See [Deploy guide — Load test](/docs/guides/deploy#load-test) and [Capacity planning](/docs/guides/capacity).

## Getting help

- [GitHub Issues](https://github.com/manyiu/vazue-queue/issues)
- [SECURITY.md](https://github.com/manyiu/vazue-queue/blob/main/SECURITY.md) for vulnerability reports
