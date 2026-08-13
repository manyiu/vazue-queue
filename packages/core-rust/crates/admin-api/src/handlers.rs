use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use platform::Capabilities;
use queue_kernel::EventConfig;
use serde_json::{json, Value};

use crate::store::{AdminError, AdminStore, LiveOverrides, Room};

#[derive(Clone)]
pub struct AdminState {
    pub store: Arc<dyn AdminStore>,
    pub tenant_id: String,
    pub capabilities: Capabilities,
}

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "vazue-queue-admin" }))
}

pub async fn get_capabilities(State(state): State<AdminState>) -> Json<Value> {
    Json(serde_json::to_value(&state.capabilities).unwrap_or(json!({})))
}

pub async fn create_room(
    State(state): State<AdminState>,
    Json(room): Json<Room>,
) -> Result<(StatusCode, Json<Room>), (StatusCode, Json<Value>)> {
    state
        .store
        .create_room(&state.tenant_id, room)
        .await
        .map(|r| (StatusCode::CREATED, Json(r)))
        .map_err(map_err)
}

pub async fn create_event(
    State(state): State<AdminState>,
    Json(event): Json<EventConfig>,
) -> Result<(StatusCode, Json<EventConfig>), (StatusCode, Json<Value>)> {
    state
        .store
        .create_event(&state.tenant_id, event)
        .await
        .map(|e| (StatusCode::CREATED, Json(e)))
        .map_err(map_err)
}

pub async fn list_events(
    State(state): State<AdminState>,
) -> Result<Json<Vec<EventConfig>>, (StatusCode, Json<Value>)> {
    state
        .store
        .list_events(&state.tenant_id)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn update_event(
    State(state): State<AdminState>,
    Path(event_id): Path<String>,
    Json(body): Json<LiveOverrides>,
) -> Result<Json<EventConfig>, (StatusCode, Json<Value>)> {
    state
        .store
        .update_event(&state.tenant_id, &event_id, body)
        .await
        .map(Json)
        .map_err(map_err)
}

fn map_err(e: AdminError) -> (StatusCode, Json<Value>) {
    let code = match e {
        AdminError::NotFound => StatusCode::NOT_FOUND,
        AdminError::Message(_) => StatusCode::BAD_REQUEST,
    };
    (code, Json(json!({ "error": e.to_string() })))
}
