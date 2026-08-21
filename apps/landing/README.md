# Marketing landing (`queue.vazue.com`)

Static first viewport for the OSS product. Deploy to S3 + CloudFront or GitHub Pages; point `queue.vazue.com` at it when DNS is ready.

```bash
pnpm --filter @vazue/landing build
# open apps/landing/index.html or:
pnpm --filter @vazue/landing dev
```
