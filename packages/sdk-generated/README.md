# Generated Tier-1 SDKs (reference)

**Supported clients** (hand-polished):

| Language | Path | Package |
|----------|------|---------|
| TypeScript | `packages/sdk-typescript` | `@yiu/queue-sdk` |
| Go | `packages/sdk-go` | `github.com/vazue/queue-go` |
| Java | `packages/sdk-java` | `io.vazue:queue-sdk` |

Optional OpenAPI Generator stubs (not published; regenerate anytime):

```bash
bash scripts/generate-sdks.sh
```

Runs entirely in Docker (`openapitools/openapi-generator-cli:v7.14.0`) — no local Java
install. The script feeds a temporary OAS 3.1.0 copy (generator does not yet accept 3.2);
source of truth remains `openapi/vazue-queue.yaml`. Output: `packages/sdk-generated/{go,java}`
(gitignored).

Minimum client runtimes: Node 20+, Go 1.22+, Java 11+. See `docs/sdks/compatibility.md`.
