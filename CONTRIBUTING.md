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

## PR size

Prefer &lt; 400 lines when possible; one logical change per PR.

## Build cop

When `main` is red: notify, revert first if fix &gt; 15 minutes, restore green.

## Commercial code

Do not publish `packages/saas/*` to npm. See `docs/engineering/saas-license-boundary.md`.
