package queue

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func signHS256(t *testing.T, payload map[string]any, secret string) string {
	t.Helper()
	enc := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	h := enc(map[string]string{"alg": "HS256", "typ": "JWT"})
	p := enc(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(h + "." + p))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return h + "." + p + "." + sig
}

func TestVerifyAdmitToken(t *testing.T) {
	secret := "origin-secret-16chars"
	now := time.Unix(1_700_000_000, 0)
	good := signHS256(t, map[string]any{"sub": "req-1", "exp": float64(now.Unix() + 60), "event_id": "demo"}, secret)
	claims := VerifyAdmitToken(good, secret, now)
	if claims == nil || claims["event_id"] != "demo" {
		t.Fatalf("expected valid claims, got %#v", claims)
	}
	if VerifyAdmitToken(good, "wrong-secret!!!!!!", now) != nil {
		t.Fatal("expected nil for wrong secret")
	}
	expired := signHS256(t, map[string]any{"sub": "req-1", "exp": float64(now.Unix() - 1)}, secret)
	if VerifyAdmitToken(expired, secret, now) != nil {
		t.Fatal("expected nil for expired token")
	}
}

func TestExtractAdmitToken(t *testing.T) {
	if got := ExtractAdmitToken("a=1; vazue_token=abc; b=2", nil); got != "abc" {
		t.Fatalf("cookie extract: %q", got)
	}
	q := url.Values{"vazue_token": {"xyz"}}
	if got := ExtractAdmitToken("", q); got != "xyz" {
		t.Fatalf("query extract: %q", got)
	}
}

func TestClientEnrollAndStatus(t *testing.T) {
	c := NewClient("http://queue.test")
	c.HTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/enroll"):
			return jsonResponse(http.StatusCreated, `{"request_id":"r1","session_id":"s1","position":1,"status":"waiting"}`), nil
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/status"):
			if r.URL.Query().Get("request_id") != "r1" {
				return jsonResponse(http.StatusNotFound, `{"error":"not found"}`), nil
			}
			return jsonResponse(http.StatusOK, `{"request_id":"r1","position":1,"serving":0,"wait_estimate_minutes":1,"poll_after_seconds":2,"status":"waiting","admitted":false}`), nil
		default:
			return jsonResponse(http.StatusNotFound, `{}`), nil
		}
	})}
	enrolled, err := c.Enroll(context.Background(), "demo", EnrollRequest{ReturnURL: "https://example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if enrolled.Position != 1 {
		t.Fatalf("position=%d", enrolled.Position)
	}
	st, err := c.Status(context.Background(), "demo", enrolled.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != "waiting" {
		t.Fatalf("status=%s", st.Status)
	}
}

func TestClientStatus404Soft(t *testing.T) {
	c := NewClient("http://queue.test")
	c.HTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusNotFound, `{"error":"not found"}`), nil
	})}
	st, err := c.Status(context.Background(), "demo", "pending")
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != "enrolled" || st.PollAfterSeconds != 2 {
		t.Fatalf("%#v", st)
	}
}
