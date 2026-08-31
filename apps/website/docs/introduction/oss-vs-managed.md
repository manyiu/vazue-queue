# Open source vs managed

Vazue Queue ships as **open source** and as a **managed service** (SaaS) built on the same core.

## Open source (self-host)

- Deploy with [`@yiu/queue-cdk`](https://www.npmjs.com/package/@yiu/queue-cdk) into a **dedicated** AWS account
- Apache-2.0 license for published npm packages
- Full control over presets, capacity, and AWS spend
- Source: [github.com/manyiu/vazue-queue](https://github.com/manyiu/vazue-queue)

[Self-host guide →](/oss)

## Managed (SaaS)

- Hosted waiting rooms and admin at `*.wait.queue.vazue.com` / `app.queue.vazue.com`
- Usage-based billing (Stripe metering in `packages/saas/` — commercial, not published to npm)
- Same enroll/status/admit API contract as open source

[Pricing →](/pricing) (coming soon)

## Shared technical docs

Architecture, visitor flow, presets, capacity, and API reference apply to **both** paths. Start with [Architecture](/docs/concepts/architecture).

## License boundary

| Path | License |
|------|---------|
| `@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk` | Apache-2.0 |
| `packages/saas/` | Commercial — not redistributed as open source |

See [`packages/saas/NOTICE.md`](https://github.com/manyiu/vazue-queue/blob/main/packages/saas/NOTICE.md) on GitHub.
