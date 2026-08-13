# Hand-polished Go client for Vazue Queue (enroll / status / verify).

Minimum: **Go 1.22+**.

```bash
go get github.com/vazue/queue-go@latest
```

```go
client := queue.NewClient("https://queue.example.com")
enrolled, err := client.Enroll(ctx, "demo", queue.EnrollRequest{ReturnURL: "https://shop.example.com/checkout"})
status, err := client.Status(ctx, "demo", enrolled.RequestID)
ok := queue.VerifyAdmitToken(status.AdmitToken, hmacSecret, time.Now())
```

## Test without a local Go install

```bash
bash scripts/sdk-go-test.sh   # Docker — local convenience
```

CI uses native Go via `actions/setup-go` (see `.github/workflows/generate-sdks.yml`).
