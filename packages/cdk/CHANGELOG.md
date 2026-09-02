# @yiu/queue-cdk

## 1.1.0

### Minor Changes

- e6c4ac9: Remove SaaS-only DynamoDB tables (Tenants, UsageDaily, Tokens), stripe feature flag, and VAZUE_DEPLOYMENT_PROFILE env var. Redeploy existing stacks to apply the CloudFormation change.
- 1d8a0e3: Fix production waiting room defaults: same-origin API, baked `defaultEventId`, active-event lookup API, and edge redirect event param.

## 1.0.4

### Patch Changes

- 027e3dc: Turnstile operator UX: validate challenge configs at CDK deploy time, prompt for `turnstileSecretArn` in the wizard, and ship `rustls-webpki` 0.103.15 in queue Lambda binaries (redeploy stacks to pick up the TLS patch).

## 1.0.3

### Patch Changes

- aa08caa: Ship updated queue Lambda binaries: jsonwebtoken 10 (`aws_lc_rs`) and Turnstile secret loading from Secrets Manager on EnrollFn (scoped env/IAM, challenge-mode verification fixes).

## 1.0.2

### Patch Changes

- b963bef: Lean buffered EnrollFn cold start: skip DynamoDB and signing-secret init on the SQS accept path, with matching CDK env/IAM slimming and updated enroll Lambda binaries.

## 1.0.1

### Patch Changes

- 7b09923: Re-publish via GitHub Actions OIDC to attach npm provenance attestations (bootstrap 1.0.0 was local).

## 1.0.0

### Major Changes

- a26352a: OSS v1.0.0: first stable release of CDK constructs, scaffold CLI, and TypeScript SDK.

  Quality gates complete: in-region load test pass, Lambda artifacts, waiting room flow, admin portal, cost CLI, and npm provenance publish workflow.
