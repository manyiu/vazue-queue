# Product website (`queue.vazue.com`)

Unified VitePress site: marketing homepage, open source pages, and technical docs at `/docs`.

## Local preview (recommended)

```bash
pnpm website:preview
# → http://127.0.0.1:5200/
```

This builds the site and starts a static preview server. **Use `127.0.0.1:5200`** — if you previously ran a dev server, `localhost` on another port may still show a blank Vite shell.

## Dev server

```bash
pnpm website:dev
# → http://127.0.0.1:5190/
```

Port **5190** (dev) and **5200** (preview) avoid conflicts with admin portal (`5174`) and waiting room (`5173`).

## Build only

```bash
pnpm website:build
```

Output: `apps/website/.vitepress/dist`

## Deploy to AWS (CDK)

```bash
pnpm --filter @vazue/landing-cdk deploy
```

See `apps/landing-cdk/README.md`.
