# Contributing

## Trunk-based development

- Default branch: `main`
- Short-lived `feature/*` and `fix/*` branches
- Squash or rebase merge; no direct pushes to `main`
- Environments are deployments, not branches

## Before every PR

```bash
pnpm test:local
# or
pnpm verify
```

Go/Java SDK tests: install toolchains, or locally use Docker helpers
(`bash scripts/sdk-go-test.sh`, `bash scripts/sdk-java-test.sh`). CI always uses
native `setup-go` / `setup-java` — see `docs/sdks/compatibility.md`.

## Community

**GitHub Discussions** is enabled for Q&A and launch announcements.
Security reports: see `SECURITY.md` (private advisory preferred).

## OSS v1.0 definition of done

Ship `@yiu/queue-cdk` **1.0.0** only when all of these are true:

- [x] `pnpm verify` green on `main`
- [x] Lambda zips built (`REQUIRE_ARTIFACTS=1 bash scripts/build-lambda-assets.sh`)
- [ ] `standard` preset deploy smoke in us-east-1
- [x] Load-test report: `PROFILE=rc bash scripts/load-test-100k.sh` (p99 &lt; 500ms, fail rate &lt; 1%). Full 100K VUs on distributed k6 / AWS DLTS.
- [x] Docs: `docs/deploy/oss-cdk.md` + cost CLI (`npx vazue-queue cost`)
- [ ] npm provenance publish of `@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk` only (`scripts/check-publish-boundary.sh`)

See `docs/launch/oss-v1.md`.

## PR size

Prefer &lt; 400 lines when possible; one logical change per PR.

## Build cop

When `main` is red: notify, revert first if fix &gt; 15 minutes, restore green.

## Commercial code

Do not publish `packages/saas/*` to npm. See `docs/engineering/saas-license-boundary.md`.
