# SDK compatibility

Hand-polished clients are the supported SDKs. OpenAPI Generator stubs under
`packages/sdk-generated/` are optional reference output.

| Language | Package | Min runtime | Local | CI (every PR via `ci.yml`) |
|----------|---------|-------------|-------|----------------------------|
| TypeScript | `@vazue/queue-sdk` | Node 20+ | `pnpm --filter @vazue/queue-sdk test` | `setup-node` |
| Go | `github.com/vazue/queue-go` | Go 1.22+ | `bash scripts/sdk-go-test.sh` (Docker) | `actions/setup-go` + `go test` |
| Java | `io.vazue:queue-sdk` | Java 11+ | `bash scripts/sdk-java-test.sh` (Docker) | `actions/setup-java` + `mvn test` |

**Policy:** Docker for local convenience (`scripts/sdk-*-test.sh`; `pnpm verify`
prefers Docker locally). Native toolchains in GitHub Actions (faster, cacheable).
`scripts/verify.sh` never uses Docker when `GITHUB_ACTIONS=true`.

Optional reference stubs (Docker generator image — OK in CI and local):

```bash
bash scripts/generate-sdks.sh
```

Path-filtered workflow: `.github/workflows/generate-sdks.yml` (native SDK tests +
generator stubs). Every-PR coverage is `.github/workflows/ci.yml` → `pnpm verify`.

Admit tokens: same HS256 secret as `security.jwtHmacSecret`
(see `docs/engineering/jwt-keys.md`).
