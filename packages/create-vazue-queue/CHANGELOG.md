# create-vazue-queue

## 1.0.2

### Patch Changes

- 027e3dc: Turnstile operator UX: validate challenge configs at CDK deploy time, prompt for `turnstileSecretArn` in the wizard, and ship `rustls-webpki` 0.103.15 in queue Lambda binaries (redeploy stacks to pick up the TLS patch).

## 1.0.1

### Patch Changes

- 7b09923: Re-publish via GitHub Actions OIDC to attach npm provenance attestations (bootstrap 1.0.0 was local).

## 1.0.0

### Major Changes

- a26352a: OSS v1.0.0: first stable release of CDK constructs, scaffold CLI, and TypeScript SDK.

  Quality gates complete: in-region load test pass, Lambda artifacts, waiting room flow, admin portal, cost CLI, and npm provenance publish workflow.
