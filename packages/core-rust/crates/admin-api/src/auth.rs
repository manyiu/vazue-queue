//! Optional Bearer JWT gate for admin routes.
//! Skip when ADMIN_DEV_AUTH=1 or VAZUE_LOCAL=1 (local dual-server default).

use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub fn auth_required() -> bool {
    if std::env::var("ADMIN_DEV_AUTH").ok().as_deref() == Some("1") {
        return false;
    }
    if std::env::var("VAZUE_LOCAL").ok().as_deref() == Some("1") {
        return false;
    }
    std::env::var("ADMIN_REQUIRE_JWT").ok().as_deref() == Some("1")
}

pub async fn require_bearer(req: Request, next: Next) -> Response {
    if !auth_required() {
        return next.run(req).await;
    }
    let path = req.uri().path();
    if path == "/health" || path.ends_with("/health") {
        return next.run(req).await;
    }
    let auth = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !auth.starts_with("Bearer ") || auth.len() < 16 {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "missing or invalid bearer token" })),
        )
            .into_response();
    }
    // API Gateway JWT authorizer validates Cognito tokens in AWS.
    // Local ADMIN_REQUIRE_JWT only checks presence of a Bearer token.
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_skips_auth() {
        std::env::set_var("VAZUE_LOCAL", "1");
        std::env::remove_var("ADMIN_REQUIRE_JWT");
        assert!(!auth_required());
        std::env::remove_var("VAZUE_LOCAL");
    }
}
