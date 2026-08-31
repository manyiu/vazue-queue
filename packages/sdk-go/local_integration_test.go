//go:build integration

package queue_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	queue "github.com/vazue/queue-go"
)

const (
	localSecret = "local-dev-hmac-secret-change-me"
	eventID     = "demo"
)

func apiBase() string {
	if v := os.Getenv("QUEUE_API_URL"); v != "" {
		return v
	}
	return "http://127.0.0.1:3000"
}

func adminBase() string {
	if v := os.Getenv("ADMIN_API_URL"); v != "" {
		return v
	}
	return "http://127.0.0.1:3001"
}

func setEmergencyOpen(t *testing.T, open bool) {
	t.Helper()
	body, _ := json.Marshal(map[string]bool{"emergency_open": open})
	req, err := http.NewRequest(http.MethodPut, adminBase()+"/v1/events/"+eventID, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("admin update: %d", res.StatusCode)
	}
}

func TestLocalEnrollAdmitVerify(t *testing.T) {
	setEmergencyOpen(t, true)
	t.Cleanup(func() { setEmergencyOpen(t, false) })

	client := queue.NewClient(apiBase())
	ctx := context.Background()

	enrolled, err := client.Enroll(ctx, eventID, queue.EnrollRequest{
		ReturnURL: "https://example.com/checkout",
	})
	if err != nil {
		t.Fatal(err)
	}

	status, err := client.Status(ctx, eventID, enrolled.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Admitted || status.AdmitToken == "" {
		t.Fatalf("expected admission, got %#v", status)
	}

	claims := queue.VerifyAdmitToken(status.AdmitToken, localSecret, time.Now())
	if claims == nil {
		t.Fatal("verifyAdmitToken returned nil")
	}
}
