# Security

## Admit tokens (JWT)

- Signed with **HS256** on admit
- Returned on **GET status** when `admitted=true`
- Origin verifies with `@yiu/queue-sdk` `verifyAdmitToken`
- Signing key in **Secrets Manager** (deployed) or env var (local)

Lambda@Edge **cannot use environment variables** — `full` preset bakes `jwtHmacSecret` into `edge-config.js` beside the handler. Must match data-plane signing secret.

## Bot protection (Turnstile)

**Default:** `security.botProtection.mode` is **`off`** — no Cloudflare account, no CAPTCHA widget.

Enable Turnstile only when enroll should require a Cloudflare challenge:

| Mode | Cloudflare Turnstile | Notes |
|------|-----------|-------|
| `off` | No | Default |
| `rate_limit_only` | No | IP rate limits only |
| `challenge_suspicious` | Yes | Challenge when suspicious |
| `challenge_always` | Yes | Challenge every enroll |

Challenge modes require `turnstileSiteKey` (public) and `turnstileSecretArn` (Secrets Manager — never put secret value in config JSON).

## Admin authentication

**Full preset:** Cognito user pool + JWT authorizer on admin API.

Local dev: `ADMIN_DEV_AUTH=1` skips Bearer checks.

## WAF

**Full preset** enables WAF rate limiting on waiting room / API distributions.

## CORS

Configure `security.corsAllowedOrigins` for browser clients calling the API from other origins.

## Reporting vulnerabilities

See [SECURITY.md on GitHub](https://github.com/manyiu/vazue-queue/blob/main/SECURITY.md). Do not report SaaS billing issues via public channels.

## Related

- [Deploy guide — Turnstile setup](/docs/guides/deploy#bot-protection-turnstile)
- [Configuration reference](/docs/reference/config)
