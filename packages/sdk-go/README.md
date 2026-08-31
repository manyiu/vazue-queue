# Hand-polished Go client for Vazue Queue (enroll / status / verify).

Minimum: **Go 1.22+**.

```bash
go get github.com/vazue/queue-go@latest
```

## Client

```go
client := queue.NewClient("https://queue.example.com")
enrolled, err := client.Enroll(ctx, "my-event", queue.EnrollRequest{
    ReturnURL: "https://shop.example.com/checkout",
})
status, err := client.WaitUntilAdmitted(ctx, "my-event", enrolled.RequestID, 3600)
```

## Origin verification

```go
token := queue.ExtractAdmitTokenFromRequest(r)
claims := queue.VerifyAdmitToken(token, os.Getenv("VAZUE_JWT_SECRET"), time.Now())
```

## Tests

```bash
go test -count=1 ./...                              # unit tests
bash scripts/sdk-go-test.sh                         # Docker (no local Go)
SDK_INTEGRATION=1 go test -tags=integration ./...   # against local-server
```

## Docs

[queue.vazue.com/docs/reference/sdks](https://queue.vazue.com/docs/reference/sdks)
