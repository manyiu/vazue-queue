# @yiu/queue-cdk

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
