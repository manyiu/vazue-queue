# @yiu/queue-sdk

TypeScript client and admit-token helpers for Vazue Queue.

## Install

```bash
npm install @yiu/queue-sdk
```

## Client

```ts
import { QueueClient } from '@yiu/queue-sdk';

const client = new QueueClient({ baseUrl: 'https://queue.example.com' });
const { request_id } = await client.enroll('my-event', { return_url: 'https://shop.example.com/checkout' });
const status = await client.status('my-event', request_id);
```

## Origin verification

Reject requests without a valid admit token on your protected origin:

```ts
import { verifyAdmitToken } from '@yiu/queue-sdk';

const claims = verifyAdmitToken(token, process.env.VAZUE_JWT_SECRET!);
if (!claims) {
  // reject request
}
```

Go and Java clients live in the monorepo (`packages/sdk-go`, `packages/sdk-java`).

## License

Apache-2.0
