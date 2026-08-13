//! In-process JWT signing (private key from Secrets Manager at Lambda init).

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JwtError {
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("invalid key material")]
    InvalidKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdmitClaims {
    pub tenant_id: String,
    pub event_id: String,
    pub request_id: String,
    pub return_url: Option<String>,
    pub exp: i64,
    pub iat: i64,
    pub iss: String,
}

pub struct JwtKeys {
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl JwtKeys {
    /// Load from PEM private key (PKCS#8 or RSA).
    pub fn from_rsa_pem(private_pem: &[u8], public_pem: &[u8]) -> Result<Self, JwtError> {
        let encoding = EncodingKey::from_rsa_pem(private_pem).map_err(|_| JwtError::InvalidKey)?;
        let decoding = DecodingKey::from_rsa_pem(public_pem).map_err(|_| JwtError::InvalidKey)?;
        Ok(Self { encoding, decoding })
    }

    /// Dev/test helper: HS256 shared secret.
    pub fn from_hmac_secret(secret: &[u8]) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret),
            decoding: DecodingKey::from_secret(secret),
        }
    }
}

pub fn sign_admit_token(
    keys: &JwtKeys,
    tenant_id: &str,
    event_id: &str,
    request_id: &str,
    return_url: Option<String>,
    ttl_seconds: i64,
    use_rsa: bool,
) -> Result<String, JwtError> {
    let now = Utc::now();
    let claims = AdmitClaims {
        tenant_id: tenant_id.to_string(),
        event_id: event_id.to_string(),
        request_id: request_id.to_string(),
        return_url,
        iat: now.timestamp(),
        exp: (now + Duration::seconds(ttl_seconds)).timestamp(),
        iss: "vazue-queue".to_string(),
    };
    let header = Header::new(if use_rsa {
        Algorithm::RS256
    } else {
        Algorithm::HS256
    });
    Ok(encode(&header, &claims, &keys.encoding)?)
}

pub fn verify_admit_token(
    keys: &JwtKeys,
    token: &str,
    use_rsa: bool,
) -> Result<AdmitClaims, JwtError> {
    let mut validation = Validation::new(if use_rsa {
        Algorithm::RS256
    } else {
        Algorithm::HS256
    });
    validation.set_issuer(&["vazue-queue"]);
    let data = decode::<AdmitClaims>(token, &keys.decoding, &validation)?;
    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_hmac() {
        let keys = JwtKeys::from_hmac_secret(b"test-secret-key-please-change");
        let token = sign_admit_token(
            &keys,
            "default",
            "evt1",
            "req1",
            Some("https://example.com/checkout".into()),
            3600,
            false,
        )
        .unwrap();
        let claims = verify_admit_token(&keys, &token, false).unwrap();
        assert_eq!(claims.request_id, "req1");
        assert_eq!(claims.event_id, "evt1");
    }
}
