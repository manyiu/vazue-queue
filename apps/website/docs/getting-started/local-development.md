# Local development

Run the data plane and admin API locally without AWS.

## Prerequisites

- Node.js 24+, pnpm, Rust toolchain (for `cargo run` local-server)
- Docker — optional (`docker compose` for DynamoDB Local; SDK tests can use Docker helpers)

No AWS account or Cloudflare account is needed for local API and waiting-room development.

## Dual API server

```bash
pnpm install
docker compose -f docker-compose.local.yml up -d   # optional DynamoDB Local
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
```

- Queue API: `http://localhost:3000`
- Admin API: `http://localhost:3001`
- Sets `VAZUE_LOCAL=1` and `ADMIN_DEV_AUTH=1` (admin Bearer checks skipped)

## Waiting room UI

```bash
pnpm --filter @vazue/waiting-room dev
```

## Admin portal

```bash
NEXT_PUBLIC_ADMIN_DEV_AUTH=1 pnpm --filter @vazue/admin-portal dev
```

Runs on port **5174**. Deployed admin loads Cognito + API URLs from `/config.js`.

To exercise JWT checks locally: unset dev flags and set `ADMIN_REQUIRE_JWT=1`.

## Monorepo verify

```bash
pnpm verify
```

Runs Rust tests, CDK tests, SDK tests, and package checks.

## SDK smoke test

With `local-server` running:

```bash
bash scripts/sdk-smoke.sh
```

Enrolls against the `demo` event, receives an admit token, and verifies it with each SDK. See [SDK reference](/docs/reference/sdks).

## Website (this site)

```bash
pnpm website:dev
```

## Next steps

- [Architecture](/docs/concepts/architecture)
- [Deploy with CDK](/docs/guides/deploy)
