package queue

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// AdmitTokenClaims are the HS256 JWT claims returned on admit.
type AdmitTokenClaims map[string]any

// VerifyAdmitToken verifies an HS256 admit JWT with the same secret as security.jwtHmacSecret.
// Returns nil when the token is missing, malformed, expired, or signed with the wrong secret.
func VerifyAdmitToken(token, secret string, now time.Time) AdmitTokenClaims {
	if token == "" || secret == "" {
		return nil
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil
	}
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil
	}

	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil
	}
	if header.Alg != "" && header.Alg != "HS256" {
		return nil
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	expected := mac.Sum(nil)
	if subtle.ConstantTimeCompare(expected, sig) != 1 {
		return nil
	}

	var claims AdmitTokenClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil
	}
	if exp, ok := claims["exp"].(float64); ok {
		if now.IsZero() {
			now = time.Now()
		}
		if float64(now.Unix()) >= exp {
			return nil
		}
	}
	return claims
}

// ExtractAdmitToken reads vazue_token from a Cookie header or query values.
func ExtractAdmitToken(cookieHeader string, query url.Values) string {
	const name = "vazue_token"
	if cookieHeader != "" {
		for _, part := range strings.Split(cookieHeader, ";") {
			part = strings.TrimSpace(part)
			if k, v, ok := strings.Cut(part, "="); ok && k == name {
				if decoded, err := url.QueryUnescape(v); err == nil {
					return decoded
				}
				return v
			}
		}
	}
	if query != nil {
		if v := query.Get(name); v != "" {
			return v
		}
	}
	return ""
}

// ExtractAdmitTokenFromRequest is a convenience wrapper for http.Request.
func ExtractAdmitTokenFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	return ExtractAdmitToken(r.Header.Get("Cookie"), r.URL.Query())
}
