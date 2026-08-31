# Queue API

Canonical spec: [`openapi/vazue-queue.yaml` on GitHub](https://github.com/manyiu/vazue-queue/blob/main/openapi/vazue-queue.yaml).

**Admit tokens are returned on GET status** when the visitor is admitted.

## Data plane (visitor-facing)

Base URL: the queue domain or `http://localhost:3000` locally.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness (`deployment`, `tenantId`) |
| `POST` | `/v1/events/{eventId}/enroll` | Join queue; idempotent by `session_id` |
| `GET` | `/v1/events/{eventId}/status` | Poll position; returns `admit_token` when admitted |
| `POST` | `/v1/events/{eventId}/admit` | Optional; prefer status in happy path |

### Enroll request body

```json
{
  "session_id": "browser-session-uuid",
  "return_url": "https://shop.example.com/checkout",
  "turnstile_token": "optional"
}
```

### Status response (waiting)

```json
{
  "request_id": "…",
  "position": 42,
  "serving": 10,
  "wait_estimate_minutes": 5,
  "poll_after_seconds": 5,
  "admitted": false
}
```

### Status response (admitted)

```json
{
  "admitted": true,
  "admit_token": "eyJ…",
  "return_url": "https://shop.example.com/checkout"
}
```

## Control plane (admin)

Base URL: admin API (`:3001` locally) or `api.queue.vazue.com` (SaaS).

Requires Cognito JWT (deployed) or dev auth bypass (local).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/capabilities` | Deployment profile and plan limits |
| `GET/POST` | `/v1/rooms` | Room CRUD |
| `GET/POST/PATCH` | `/v1/events` | Event CRUD + live overrides |
| `GET` | `/v1/events/{id}/export` | CSV export |

## Servers (OpenAPI)

| URL | Use |
|-----|-----|
| `http://localhost:3000` | Local data plane |
| `https://queue.example.com` | Open source self-hosted |
| `https://api.queue.vazue.com` | SaaS management |

[Visitor flow →](/docs/concepts/visitor-flow) · [SDKs →](/docs/reference/sdks)
