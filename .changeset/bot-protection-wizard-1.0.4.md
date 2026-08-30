---
"@yiu/queue-cdk": patch
"create-vazue-queue": patch
---

Turnstile operator UX: validate challenge configs at CDK deploy time, prompt for `turnstileSecretArn` in the wizard, and ship `rustls-webpki` 0.103.15 in queue Lambda binaries (redeploy stacks to pick up the TLS patch).
