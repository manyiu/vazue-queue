// Package queue is the Go client for Vazue Queue (enroll / status / admit helpers).
package queue

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type EnrollRequest struct {
	RequestID      string `json:"request_id,omitempty"`
	SessionID      string `json:"session_id,omitempty"`
	ReturnURL      string `json:"return_url,omitempty"`
	TurnstileToken string `json:"turnstile_token,omitempty"`
}

type EnrollResponse struct {
	RequestID string `json:"request_id"`
	SessionID string `json:"session_id"`
	Position  int    `json:"position"`
	Status    string `json:"status"`
}

type StatusResponse struct {
	RequestID           string  `json:"request_id"`
	Position            int     `json:"position"`
	Serving             int     `json:"serving"`
	WaitEstimateMinutes float64 `json:"wait_estimate_minutes"`
	PollAfterSeconds    int     `json:"poll_after_seconds"`
	Status              string  `json:"status"`
	Admitted            bool    `json:"admitted"`
	AdmitToken          string  `json:"admit_token,omitempty"`
	ReturnURL           string  `json:"return_url,omitempty"`
	DressRehearsal      bool    `json:"dress_rehearsal,omitempty"`
}

// Client talks to the Vazue Queue data plane HTTP API.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		HTTPClient: http.DefaultClient,
	}
}

func (c *Client) Enroll(ctx context.Context, eventID string, body EnrollRequest) (*EnrollResponse, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/events/"+url.PathEscape(eventID)+"/enroll", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	// 201 sync · 202 async enroll buffer
	if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusAccepted {
		return nil, fmt.Errorf("enroll failed: %d %s", res.StatusCode, string(data))
	}
	var out EnrollResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Status(ctx context.Context, eventID, requestID string) (*StatusResponse, error) {
	u, err := url.Parse(c.BaseURL + "/v1/events/" + url.PathEscape(eventID) + "/status")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("request_id", requestID)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode == http.StatusNotFound {
		return &StatusResponse{
			RequestID:        requestID,
			PollAfterSeconds: 2,
			Status:           "enrolled",
		}, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("status failed: %d %s", res.StatusCode, string(data))
	}
	var out StatusResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// WaitUntilAdmitted polls status until admitted or maxAttempts.
func (c *Client) WaitUntilAdmitted(ctx context.Context, eventID, requestID string, maxAttempts int) (*StatusResponse, error) {
	if maxAttempts <= 0 {
		maxAttempts = 3600
	}
	for i := 0; i < maxAttempts; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		s, err := c.Status(ctx, eventID, requestID)
		if err != nil {
			return nil, err
		}
		if s.Admitted {
			return s, nil
		}
		wait := s.PollAfterSeconds
		if wait <= 0 {
			wait = 5
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(wait) * time.Second):
		}
	}
	return nil, fmt.Errorf("timed out waiting for admission")
}

func (c *Client) Health(ctx context.Context) (map[string]any, error) {
	return c.getJSON(ctx, "/health")
}

func (c *Client) Ready(ctx context.Context) (map[string]any, error) {
	return c.getJSON(ctx, "/ready")
}

func (c *Client) getJSON(ctx context.Context, path string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}
