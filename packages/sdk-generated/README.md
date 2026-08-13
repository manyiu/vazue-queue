# Generated Tier-1 SDKs

TypeScript reference SDK: `@vazue/queue-sdk` (hand-written).

Other languages are generated from `openapi/vazue-queue.yaml` via OpenAPI Generator in CI:

| Language | Package | Registry |
|----------|---------|----------|
| Python | `vazue-queue` | PyPI |
| Go | `github.com/vazue/vazue-queue-go` | Go modules |
| Java | `io.vazue:queue-sdk` | Maven Central |
| C# | `Vazue.Queue` | NuGet |

Minimum client runtimes: Node 20+, Python 3.10+, Go 1.22+, Java 11+, .NET 8+.

Generate locally:

```bash
openapi-generator-cli generate -i openapi/vazue-queue.yaml -g python -o packages/sdk-python
openapi-generator-cli generate -i openapi/vazue-queue.yaml -g go -o packages/sdk-go
openapi-generator-cli generate -i openapi/vazue-queue.yaml -g java -o packages/sdk-java
openapi-generator-cli generate -i openapi/vazue-queue.yaml -g csharp -o packages/sdk-csharp
```
