# Deploy OSS with CDK

```bash
npx create-vazue-queue my-queue   # interactive wizard
cd my-queue
pnpm install
npx cdk bootstrap
npm run deploy
```

Non-interactive:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

Reconfigure:

```bash
npx vazue-queue config
npx vazue-queue config --validate
```

Default AWS region for examples: **us-east-1**.
