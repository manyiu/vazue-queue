# SaaS license boundary

## Decision (locked)

- **Monorepo:** public `vazue-queue` with Apache-2.0 for OSS packages.
- **`packages/saas/`:** commercial code in the same monorepo; **never published to npm**.
- **Published to npm only:** `@vazue/queue-cdk`, `create-vazue-queue`, `@vazue/queue-sdk`, `@vazue/queue-edge-cloudfront`.

## Rules

1. Do not add `packages/saas/*` to Changesets publishable list.
2. Release workflow must filter private packages.
3. OSS tarball must not include SaaS Stripe secrets or plan-limit enforcement as a required dependency of `@vazue/queue-cdk`.
