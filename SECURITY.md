# Security Policy

## Reporting

Report vulnerabilities privately:

1. Prefer a [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories) on this repository, or
2. Email **security@vazue.com**

Please include steps to reproduce, affected package/version, and impact. Do **not** open a public issue for security flaws.

We aim to acknowledge reports within **3 business days** and share a remediation plan or status update within **10 business days**.

## Scope

**In scope**

- Published OSS packages: `@yiu/queue-cdk`, `create-vazue-queue`, `@yiu/queue-sdk`
- Queue data plane / admin APIs, waiting room, Lambda@Edge connector as shipped in this repo
- Admit-token verification helpers (forgery, bypass of signature checks)

**Out of scope**

- Denial-of-service against your own AWS account quotas
- Issues that require already-compromised AWS credentials
- Third-party dependencies without a Vazue-specific exploit path (report upstream when appropriate)

## Supported versions

Security fixes target the **latest published major** on npm, plus **N−1** for at least 12 months after a new major (see SDK compatibility docs).

## Safe harbor

Good-faith research that follows this policy and avoids privacy violations / service disruption is welcome. We will not pursue legal action for such reports.
