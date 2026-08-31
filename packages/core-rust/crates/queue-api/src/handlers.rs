use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;
use crate::store::{ActiveEventResponse, EnrollRequest, EnrollResponse, StatusResponse};

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "vazue-queue" }))
}

pub async fn ready(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": "ready",
        "tenantId": state.tenant_id,
    }))
}

pub async fn enroll(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
    Json(mut body): Json<EnrollRequest>,
) -> Result<(StatusCode, Json<EnrollResponse>), (StatusCode, Json<Value>)> {
    body.event_id = event_id.clone();
    if let Err(e) = state.verify_enroll_turnstile(&body).await {
        let status = if e == "captcha failed" {
            StatusCode::CONFLICT
        } else {
            StatusCode::BAD_GATEWAY
        };
        return Err((status, Json(json!({ "error": e }))));
    }
    match state
        .require_store()
        .enroll(&state.tenant_id, body, state.require_keys(), state.use_rsa)
        .await
    {
        Ok(resp) => Ok((StatusCode::CREATED, Json(resp))),
        Err(e) => Err(map_err(e)),
    }
}

#[derive(Deserialize)]
pub struct StatusQuery {
    pub request_id: String,
}

pub async fn status(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
    Query(q): Query<StatusQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let resp = state
        .require_store()
        .status(
            &state.tenant_id,
            &event_id,
            &q.request_id,
            state.require_keys(),
            state.use_rsa,
        )
        .await
        .map_err(map_err)?;
    let max_age = resp.poll_after_seconds.clamp(1, 30);
    let mut res = (StatusCode::OK, Json(resp)).into_response();
    if let Ok(v) = HeaderValue::from_str(&format!(
        "public, max-age={max_age}, stale-while-revalidate=1"
    )) {
        res.headers_mut().insert(header::CACHE_CONTROL, v);
    }
    Ok(res)
}

#[derive(Deserialize)]
pub struct AdmitBody {
    pub request_id: String,
}

pub async fn admit(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
    Json(body): Json<AdmitBody>,
) -> Result<Json<StatusResponse>, (StatusCode, Json<Value>)> {
    state
        .require_store()
        .admit(
            &state.tenant_id,
            &event_id,
            &body.request_id,
            state.require_keys(),
            state.use_rsa,
        )
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    Json(serde_json::to_value(&state.capabilities).unwrap_or(json!({})))
}

pub async fn active_event(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<ActiveEventResponse>, (StatusCode, Json<Value>)> {
    state
        .require_store()
        .active_event(&state.tenant_id, &room_id)
        .await
        .map(Json)
        .map_err(map_err)
}

fn map_err(e: crate::store::StoreError) -> (StatusCode, Json<Value>) {
    use crate::store::StoreError;
    let (code, msg) = match e {
        StoreError::NotFound => (StatusCode::NOT_FOUND, e.to_string()),
        StoreError::Conflict(m) => (StatusCode::CONFLICT, m),
        StoreError::Message(m) => (StatusCode::BAD_REQUEST, m),
    };
    (code, Json(json!({ "error": msg })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::store::{InMemoryStore, QueueStore};
    use axum::extract::Path;

    fn app_state() -> AppState {
        AppState::local(Arc::new(InMemoryStore::new()), b"local-test-secret-16b")
    }

    #[tokio::test]
    async fn ready_returns_tenant_without_deployment() {
        let state = app_state();
        let Json(body) = ready(State(state)).await;
        assert_eq!(body["status"], "ready");
        assert_eq!(body["tenantId"], "default");
        assert!(body.get("deployment").is_none());
    }

    #[tokio::test]
    async fn capabilities_expose_full_oss_limits() {
        let state = app_state();
        let Json(body) = capabilities(State(state)).await;
        assert_eq!(body["limits"]["max_counter_shards"], 64);
        assert_eq!(body["limits"]["max_throughput_per_minute"], 10_000);
        assert!(body.get("deployment").is_none());
        assert!(body["features"].get("valkey").is_none());
    }

    #[tokio::test]
    async fn active_event_returns_room_live_event() {
        let store = Arc::new(InMemoryStore::new());
        let event = queue_kernel::EventConfig {
            event_id: "live".into(),
            room_id: "default".into(),
            throughput_per_minute: 100,
            paused: false,
            emergency_open: false,
            dress_rehearsal: false,
            bot_protection: queue_kernel::BotProtectionMode::Off,
            return_url: Some("https://example.com/checkout".into()),
        };
        store.ensure_event("default", event).await.unwrap();
        store
            .set_active_event("default", "default", "live")
            .await
            .unwrap();
        let state = AppState::local(store, b"local-test-secret-16b");
        let Json(body) = active_event(State(state), Path("default".to_string()))
            .await
            .expect("active event");
        assert_eq!(body.event_id, "live");
        assert_eq!(body.room_id, "default");
    }
}
