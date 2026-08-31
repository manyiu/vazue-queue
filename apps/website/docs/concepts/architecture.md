# Architecture

Vazue Queue is a **virtual waiting room** deployed on AWS. When flash traffic hits a site, visitors join a fair FIFO line, poll for their position, and receive a signed **admit token** (JWT) when it is their turn. The origin verifies that token before serving protected content.

This page describes **what runs in production** — the services in the AWS account, how they connect, and what each preset adds.

## Stack overview

Running `create-vazue-queue` and `cdk deploy` provisions a stack in the **operator AWS account** (default region `us-east-1`). The operator owns the data, billing, and configuration.

```mermaid
flowchart TB
  subgraph aws [Operator AWS account]
    subgraph visitors [Visitor-facing]
      wrSite["Waiting room SPA<br/>S3 + CloudFront"]
      queueApi["Queue API<br/>API Gateway + Lambda"]
      ddb[(DynamoDB)]
      sqs[SQS enroll buffer]
    end

    subgraph operators [Operator-facing - full preset]
      adminUi["Admin portal<br/>S3 + CloudFront"]
      adminApi["Admin API<br/>API Gateway + Lambda"]
      cognito[Cognito]
    end

    subgraph protected [Protected site]
      edgeGate["Lambda@Edge gate<br/>full preset only"]
      originApp["Shop / app origin"]
    end

    secrets[Secrets Manager]
    eventbridge[EventBridge schedule]
    reaper[Serving reaper Lambda]
  end

  wrSite --> queueApi
  queueApi --> sqs --> ddb
  queueApi --> ddb
  eventbridge --> reaper --> ddb
  queueApi --> secrets
  adminUi --> adminApi --> ddb
  cognito --> adminApi
  edgeGate --> originApp
```

### What each piece does

| Component | Interaction | Purpose |
|-----------|-------------|---------|
| **Waiting room** | Visitor browser | Enroll UI, status polling, redirect with token |
| **Queue API** | Browser + backend services | `POST enroll`, `GET status`, optional `POST admit` |
| **DynamoDB** | Automatic | Visitors, positions, events, counters, tokens |
| **SQS enroll buffer** | Automatic | Absorb enroll bursts (202 + async write) |
| **Serving reaper** | Automatic | Advance serving counter every minute |
| **Admin portal** | Event operator | Create rooms/events, pause, throttle, CSV export |
| **Admin API** | Admin portal | Control plane on `:3001` locally |
| **Lambda@Edge** | Visitor to protected origin | Block origin without valid `vazue_token` |
| **Secrets Manager** | Deploy-time config | JWT signing key, Turnstile secret |

Published npm packages: `@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk`. The Rust Lambdas ship as CDK assets — no self-managed servers required.

## End-to-end: three actors

```mermaid
flowchart LR
  subgraph visitor [Visitor]
    V[Browser]
  end

  subgraph vazue [Vazue Queue stack]
    WR[Waiting room]
    API[Queue API]
    DB[(DynamoDB)]
  end

  subgraph operator [Event operator]
    ADM[Admin portal]
  end

  subgraph origin [Protected application]
    APP[Shop / API origin]
  end

  V -->|1 enroll + poll| WR --> API --> DB
  ADM -->|configure event| API
  V -->|2 redirect with JWT| APP
  APP -->|3 verify token| APP
```

1. **Visitor** — joins the queue via waiting room, waits, gets admitted, lands on the protected site with `?vazue_token=…`
2. **Operator** — sets throughput, pauses the queue, opens floodgates during an event
3. **Origin** — verifies the admit JWT with `@yiu/queue-sdk` before serving protected pages

## Data plane vs control plane

```mermaid
flowchart TB
  subgraph dataPlane ["Data plane :3000 — visitor traffic"]
    direction TB
    apigw[API Gateway HTTP API]
    enroll[Enroll Lambda]
    status[Status Lambda]
    admit[Admit Lambda]
    apigw --> enroll
    apigw --> status
    apigw --> admit
  end

  subgraph controlPlane ["Control plane :3001 — operator traffic"]
    direction TB
    adminApigw[Admin HTTP API]
    adminFn[Admin API Lambda]
    cognito[Cognito JWT]
    adminApigw --> adminFn
    cognito -.-> adminApigw
  end

  ddb[(DynamoDB)]
  enroll --> ddb
  status --> ddb
  admit --> ddb
  adminFn --> ddb

  eb[EventBridge 1 min] --> reaper[Serving reaper] --> ddb
  sqs[SQS] --> worker[Enroll worker] --> ddb
  enroll -.->|202 async| sqs
```

| Plane | Local port | Auth | Endpoints |
|-------|------------|------|-----------|
| **Data** | `:3000` | Public (+ optional Turnstile on enroll) | `/enroll`, `/status`, `/admit` |
| **Control** | `:3001` | Cognito JWT (full preset) | `/v1/rooms`, `/v1/events`, live overrides |

Both expose `GET /health` and `GET /ready`.

## Network path by preset

### `standard` preset (recommended)

```mermaid
flowchart LR
  browser[Visitor browser]
  cfWr[CloudFront<br/>waiting room]
  cfApi[CloudFront<br/>status cache]
  apigw[API Gateway]
  lambda[Lambda]
  ddb[(DynamoDB)]

  browser --> cfWr
  browser --> cfApi
  cfWr --> apigw
  cfApi --> apigw
  apigw --> lambda --> ddb
```

Status polls can be **edge-cached** (2–30s TTL per `request_id`) — less load on Lambda than polling the API directly.

### `full` preset (+ operator + origin gate)

```mermaid
flowchart TB
  browser[Visitor]
  wrCf[CloudFront waiting room]
  api[Queue API]
  adminCf[CloudFront admin portal]
  adminApi[Admin API]
  edgeCf[CloudFront origin gate]
  shop[Protected shop origin]

  browser --> wrCf --> api
  browser --> edgeCf
  edgeCf -->|valid vazue_token| shop
  edgeCf -->|missing token| wrCf
  operator[Operator] --> adminCf --> adminApi
```

## Components by preset

| Component | minimal | standard | full |
|-----------|:-------:|:--------:|:----:|
| API Gateway + Lambda + DynamoDB | ✓ | ✓ | ✓ |
| SQS enroll buffer (default on) | ✓ | ✓ | ✓ |
| CloudFront waiting room | | ✓ | ✓ |
| Admin API + Cognito | | | ✓ |
| Admin portal (S3 + CloudFront) | | | ✓ |
| WAF | | | ✓ |
| Lambda@Edge origin gate | | | ✓ |

See [Presets](/docs/concepts/presets) for when to choose each.

## AWS services bill of materials

| AWS service | Role in Vazue Queue |
|-------------|---------------------|
| **DynamoDB** (on-demand) | Visitors, events, counters, tokens, rooms |
| **API Gateway HTTP API** | Data-plane and admin routes |
| **Lambda** (Rust, arm64 default) | enroll, status, admit, enroll-worker, serving-reaper, admin-api |
| **SQS** | Enroll buffer queue |
| **EventBridge** | 1-minute schedule for serving reaper |
| **CloudFront** | Waiting room static assets; status path caching |
| **S3** | Waiting room + admin portal build artifacts |
| **Secrets Manager** | JWT signing key; optional Turnstile secret ARN |
| **Cognito** | Admin user pool (full preset) |
| **WAF** | Rate limiting (full preset) |
| **ACM + Route 53** | TLS certs and DNS for the queue domain |

Estimate cost: `npx vazue-queue cost --visitors 100000 --minutes 60` — see [AWS cost estimate](/docs/guides/cost) for scenarios and breakdown.

## Related

- [Visitor flow](/docs/concepts/visitor-flow) — sequence diagram of enroll → admit
- [Data model](/docs/concepts/data-model) — DynamoDB tables
- [Deploy with CDK](/docs/guides/deploy)
