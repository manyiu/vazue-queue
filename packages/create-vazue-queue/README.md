# create-vazue-queue

Scaffold a self-hosted Vazue Queue stack and manage `vazue-queue.config.json`.

## Usage

```bash
npx create-vazue-queue my-queue
cd my-queue
pnpm install && npx cdk bootstrap && npm run deploy
```

Non-interactive:

```bash
npx create-vazue-queue my-queue --yes --domain queue.example.com --preset standard
```

Reconfigure an existing project:

```bash
npx vazue-queue config
npx vazue-queue config --validate
```

Cost estimate (us-east-1 list-price rough cut):

```bash
npx vazue-queue cost --visitors 100000 --minutes 60
```

## Docs

[`docs/deploy/oss-cdk.md`](https://github.com/manyiu/vazue-queue/blob/main/docs/deploy/oss-cdk.md)

## License

Apache-2.0
