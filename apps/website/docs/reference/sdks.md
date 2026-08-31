# SDKs

Official clients for the Vazue Queue **data plane** (`POST /enroll`, `GET /status`) and **origin verification** (HS256 admit JWT).

| Language | Package | Role |
|----------|---------|------|
| TypeScript | [`@yiu/queue-sdk`](https://www.npmjs.com/package/@yiu/queue-sdk) | Browser or Node waiting-room client + origin helpers |
| Go | [`github.com/vazue/queue-go`](https://github.com/vazue/queue-go) | Server-side client + origin helpers |
| Java | `io.vazue:queue-sdk` | Server-side client + origin helpers |

Use the same HS256 secret everywhere tokens are verified: `security.jwtHmacSecret` in CDK config and at the origin.

## Try it locally

Integration examples in this repo run against the in-memory dual server:

```bash
# Terminal 1 — queue :3000 + admin :3001
cargo run -p queue-api --bin local-server --manifest-path packages/core-rust/Cargo.toml

# Terminal 2 — SDK integration smoke (enables emergency_open on demo, then enroll → verify)
bash scripts/sdk-smoke.sh
```

Local defaults:

| Setting | Value |
|---------|-------|
| Queue API | `http://localhost:3000` |
| Event id | `demo` |
| JWT secret | `local-dev-hmac-secret-change-me` |

Without `emergency_open`, the first visitor waits until the serving reaper advances (production behavior). The smoke script toggles `emergency_open` so examples get an admit token immediately.

## TypeScript — `@yiu/queue-sdk`

```bash
npm install @yiu/queue-sdk
```

Requires **Node 20+** for `verifyAdmitToken` (uses `node:crypto`).

### Waiting room: enroll and poll

```typescript
import { QueueClient } from '@yiu/queue-sdk';

const client = new QueueClient({ baseUrl: 'https://queue.example.com' });

const { request_id } = await client.enroll('my-event', {
  return_url: 'https://shop.example.com/checkout',
});

let status = await client.status('my-event', request_id);
while (!status.admitted) {
  await new Promise((r) => setTimeout(r, (status.poll_after_seconds || 5) * 1000));
  status = await client.status('my-event', request_id);
}

// Redirect visitor — preserve return_url deep link
const dest = new URL(status.return_url ?? '/');
dest.searchParams.set('vazue_token', status.admit_token!);
location.href = dest.toString();
```

Or use the built-in poller:

```typescript
const admitted = await client.waitUntilAdmitted('my-event', request_id);
console.log(admitted.admit_token);
```

`status` returns `poll_after_seconds` from the API (adaptive polling). On async enroll (`202`), a transient `404` on status is treated as `status: "enrolled"` — keep polling.

### Origin: verify the admit JWT

After redirect, the protected application receives `?vazue_token=<JWT>` (or a `vazue_token` cookie on the `full` preset).

```typescript
import { extractAdmitToken, verifyAdmitToken } from '@yiu/queue-sdk';

const secret = process.env.VAZUE_JWT_SECRET!; // same as security.jwtHmacSecret

const token = extractAdmitToken({
  cookieHeader: req.headers.cookie,
  query: new URLSearchParams(req.url.split('?')[1] ?? ''),
});

const claims = token ? verifyAdmitToken(token, secret) : null;
if (!claims) {
  // redirect to waiting room or return 403
}
```

Express-style handler:

```typescript
import express from 'express';
import { extractAdmitToken, verifyAdmitToken } from '@yiu/queue-sdk';

const app = express();
const secret = process.env.VAZUE_JWT_SECRET!;

app.get('/checkout', (req, res) => {
  const token = extractAdmitToken({ query: req.query as Record<string, string> });
  if (!token || !verifyAdmitToken(token, secret)) {
    return res.redirect('https://queue.example.com/waiting-room?returnUrl=/checkout');
  }
  res.send('Welcome to checkout');
});
```

### Local example

```typescript
import { QueueClient, verifyAdmitToken } from '@yiu/queue-sdk';

const client = new QueueClient({ baseUrl: 'http://localhost:3000' });
const { request_id } = await client.enroll('demo', {
  return_url: 'https://example.com/checkout',
});
const status = await client.status('demo', request_id);
// With emergency_open enabled (see sdk-smoke.sh), status.admitted is true:
const claims = verifyAdmitToken(status.admit_token!, 'local-dev-hmac-secret-change-me');
```

[README on GitHub](https://github.com/manyiu/vazue-queue/blob/main/packages/sdk-typescript/README.md)

## Go — `github.com/vazue/queue-go`

```bash
go get github.com/vazue/queue-go@latest
```

Requires **Go 1.22+**.

```go
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	queue "github.com/vazue/queue-go"
)

func main() {
	client := queue.NewClient("https://queue.example.com")
	ctx := context.Background()

	enrolled, err := client.Enroll(ctx, "my-event", queue.EnrollRequest{
		ReturnURL: "https://shop.example.com/checkout",
	})
	if err != nil {
		panic(err)
	}

	status, err := client.WaitUntilAdmitted(ctx, "my-event", enrolled.RequestID, 3600)
	if err != nil {
		panic(err)
	}

	claims := queue.VerifyAdmitToken(status.AdmitToken, os.Getenv("VAZUE_JWT_SECRET"), time.Now())
	if claims == nil {
		panic("invalid admit token")
	}
	fmt.Println("admitted", claims["event_id"])
}
```

Extract token from an HTTP request:

```go
token := queue.ExtractAdmitTokenFromRequest(r)
claims := queue.VerifyAdmitToken(token, secret, time.Now())
```

Local tests: `bash scripts/sdk-go-test.sh` (Docker). Integration smoke: `SDK_INTEGRATION=1 go test -tags=integration -count=1 ./...` in `packages/sdk-go`.

[README on GitHub](https://github.com/manyiu/vazue-queue/blob/main/packages/sdk-go/README.md)

## Java — `io.vazue:queue-sdk`

```xml
<dependency>
  <groupId>io.vazue</groupId>
  <artifactId>queue-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

Java **11+**.

```java
import io.vazue.queue.AdmitToken;
import io.vazue.queue.QueueClient;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

QueueClient client = new QueueClient("https://queue.example.com");

QueueClient.EnrollRequest body = new QueueClient.EnrollRequest();
body.returnUrl = "https://shop.example.com/checkout";
QueueClient.EnrollResponse enrolled = client.enroll("my-event", body);

QueueClient.StatusResponse status = client.status("my-event", enrolled.requestId);
while (!status.admitted) {
  Thread.sleep(Math.max(1, status.pollAfterSeconds) * 1000L);
  status = client.status("my-event", enrolled.requestId);
}

Optional<Map<String, Object>> claims =
    AdmitToken.verify(status.admitToken, System.getenv("VAZUE_JWT_SECRET"), Instant.now());
if (claims.isEmpty()) {
  throw new SecurityException("invalid admit token");
}
```

Extract from cookie or query:

```java
Optional<String> token = AdmitToken.extract(request.getHeader("Cookie"), request.getQueryString());
```

Local tests: `bash scripts/sdk-java-test.sh` (Docker). Integration smoke: `SDK_INTEGRATION=1 mvn test` in `packages/sdk-java`.

[README on GitHub](https://github.com/manyiu/vazue-queue/blob/main/packages/sdk-java/README.md)

## What the SDK does not cover

- **Admin API** (create events, stats, export) — call `https://admin.<your-domain>/v1/...` with a Cognito JWT, or use the admin portal.
- **Lambda@Edge** — use the CDK `full` preset; edge code is deployed automatically
- **OpenAPI-generated stubs** — reference only under `packages/sdk-generated/`; prefer the hand-polished packages above.

## Reference browser client

The vanilla waiting room is [`apps/waiting-room`](https://github.com/manyiu/vazue-queue/tree/main/apps/waiting-room) — same enroll/poll loop, no SDK dependency in the browser bundle.

## Compatibility

Go/Java unit tests run natively in GitHub Actions; Docker helpers are for laptops without Go/JDK.

Details: [compatibility.md on GitHub](https://github.com/manyiu/vazue-queue/blob/main/docs/sdks/compatibility.md)

[Visitor flow →](/docs/concepts/visitor-flow) · [API reference →](/docs/reference/api)
