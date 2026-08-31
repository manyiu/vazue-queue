# @yiu/queue-sdk

TypeScript client and admit-token helpers for Vazue Queue.

## Install

```bash
npm install @yiu/queue-sdk
```

Requires **Node 20+** for `verifyAdmitToken`.

## Waiting room client

```ts
import { QueueClient } from '@yiu/queue-sdk';

const client = new QueueClient({ baseUrl: 'https://queue.example.com' });
const { request_id } = await client.enroll('my-event', {
  return_url: 'https://shop.example.com/checkout',
});

const status = await client.waitUntilAdmitted('my-event', request_id);
// Redirect with status.admit_token as ?vazue_token=
```

## Origin verification

```ts
import { extractAdmitToken, verifyAdmitToken } from '@yiu/queue-sdk';

const token = extractAdmitToken({
  cookieHeader: req.headers.cookie,
  query: new URLSearchParams(req.url.split('?')[1] ?? ''),
});
const claims = token ? verifyAdmitToken(token, process.env.VAZUE_JWT_SECRET!) : null;
if (!claims) {
  // reject request
}
```

Use the same secret as `security.jwtHmacSecret` in your CDK config.

## Local smoke test

```bash
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml
bash scripts/sdk-smoke.sh
```

## Docs

[queue.vazue.com/docs/reference/sdks](https://queue.vazue.com/docs/reference/sdks)

## License

Apache-2.0
