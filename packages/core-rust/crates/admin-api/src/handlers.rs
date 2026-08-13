use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::IntoResponse;
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

pub async fn ready(State(state): State<AdminState>) -> Json<Value> {
    Json(json!({
        "status": "ready",
        "service": "vazue-queue-admin",
        "deployment": state.capabilities.deployment,
        "tenantId": state.tenant_id,
    }))
}

pub async fn get_capabilities(State(state): State<AdminState>) -> Json<Value> {
    Json(serde_json::to_value(&state.capabilities).unwrap_or(json!({})))
}

fn limit_err(msg: String) -> (StatusCode, Json<Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": msg, "code": "plan_limit_exceeded" })),
    )
}

pub async fn create_room(
    State(state): State<AdminState>,
    Json(room): Json<Room>,
) -> Result<(StatusCode, Json<Room>), (StatusCode, Json<Value>)> {
    state
        .capabilities
        .check_queue_limits(
            Some(room.queue.counter_shards),
            Some(room.queue.default_throughput_per_minute),
        )
        .map_err(limit_err)?;
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
        .capabilities
        .check_queue_limits(None, Some(event.throughput_per_minute))
        .map_err(limit_err)?;
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

pub async fn list_rooms(
    State(state): State<AdminState>,
) -> Result<Json<Vec<Room>>, (StatusCode, Json<Value>)> {
    state
        .store
        .list_rooms(&state.tenant_id)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn update_room(
    State(state): State<AdminState>,
    Path(room_id): Path<String>,
    Json(mut room): Json<Room>,
) -> Result<Json<Room>, (StatusCode, Json<Value>)> {
    state
        .capabilities
        .check_queue_limits(
            Some(room.queue.counter_shards),
            Some(room.queue.default_throughput_per_minute),
        )
        .map_err(limit_err)?;
    room.room_id = room_id;
    let id = room.room_id.clone();
    state
        .store
        .update_room(&state.tenant_id, &id, room)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn event_stats(
    State(state): State<AdminState>,
    Path(event_id): Path<String>,
) -> Result<Json<crate::store::EventStats>, (StatusCode, Json<Value>)> {
    state
        .store
        .event_stats(&state.tenant_id, &event_id)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn export_event(
    State(state): State<AdminState>,
    Path(event_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let stats = state
        .store
        .event_stats(&state.tenant_id, &event_id)
        .await
        .map_err(map_err)?;
    let csv = stats.to_csv();
    let mut res = (StatusCode::OK, csv).into_response();
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{event_id}-stats.csv\""))
    {
        res.headers_mut().insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(res)
}

pub async fn update_event(
    State(state): State<AdminState>,
    Path(event_id): Path<String>,
    Json(body): Json<LiveOverrides>,
) -> Result<Json<EventConfig>, (StatusCode, Json<Value>)> {
    state
        .capabilities
        .check_queue_limits(None, body.throughput_per_minute)
        .map_err(limit_err)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::InMemoryAdminStore;
    use queue_kernel::{BotProtectionMode, QueueConfig};

    fn saas_state() -> AdminState {
        AdminState {
            store: Arc::new(InMemoryAdminStore::new()),
            tenant_id: "t1".into(),
            capabilities: Capabilities::saas_free(),
        }
    }

    #[tokio::test]
    async fn saas_rejects_high_throughput_event() {
        let state = saas_state();
        let event = EventConfig {
            event_id: "e1".into(),
            room_id: "r1".into(),
            throughput_per_minute: 500,
            paused: false,
            emergency_open: false,
            invite_only: false,
            dress_rehearsal: false,
            bot_protection: BotProtectionMode::Off,
            return_url: None,
        };
        let err = create_event(State(state), Json(event)).await.unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn oss_allows_high_throughput() {
        let state = AdminState {
            store: Arc::new(InMemoryAdminStore::new()),
            tenant_id: "t1".into(),
            capabilities: Capabilities::oss_full(),
        };
        let event = EventConfig {
            event_id: "e1".into(),
            room_id: "r1".into(),
            throughput_per_minute: 5000,
            paused: false,
            emergency_open: false,
            invite_only: false,
            dress_rehearsal: false,
            bot_protection: BotProtectionMode::Off,
            return_url: None,
        };
        let ok = create_event(State(state), Json(event)).await.unwrap();
        assert_eq!(ok.0, StatusCode::CREATED);
    }

    #[tokio::test]
    async fn saas_rejects_high_shard_room() {
        let state = saas_state();
        let room = Room {
            room_id: "r1".into(),
            name: "Room".into(),
            theme: json!({}),
            queue: QueueConfig {
                default_throughput_per_minute: 100,
                counter_shards: 64,
                token_ttl_seconds: 3600,
                visitor_record_ttl_hours: 24,
            },
        };
        let err = create_room(State(state), Json(room)).await.unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn update_room_replaces_theme() {
        let state = AdminState {
            store: Arc::new(InMemoryAdminStore::new()),
            tenant_id: "t1".into(),
            capabilities: Capabilities::oss_full(),
        };
        let room = Room {
            room_id: "r1".into(),
            name: "Room".into(),
            theme: json!({ "brandName": "Old" }),
            queue: QueueConfig::default(),
        };
        let _ = create_room(State(state.clone()), Json(room)).await.unwrap();
        let updated = Room {
            room_id: "r1".into(),
            name: "Room".into(),
            theme: json!({ "brandName": "New" }),
            queue: QueueConfig::default(),
        };
        let ok = update_room(State(state), Path("r1".into()), Json(updated))
            .await
            .unwrap();
        assert_eq!(ok.theme["brandName"], "New");
    }

    #[tokio::test]
    async fn export_event_csv_includes_event_id() {
        let state = AdminState {
            store: Arc::new(InMemoryAdminStore::new()),
            tenant_id: "t1".into(),
            capabilities: Capabilities::oss_full(),
        };
        let event = EventConfig {
            event_id: "e1".into(),
            room_id: "r1".into(),
            throughput_per_minute: 50,
            paused: false,
            emergency_open: false,
            invite_only: false,
            dress_rehearsal: true,
            bot_protection: BotProtectionMode::Off,
            return_url: None,
        };
        let _ = create_event(State(state.clone()), Json(event))
            .await
            .unwrap();
        let res = export_event(State(state), Path("e1".into()))
            .await
            .unwrap()
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
        let csv = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(csv.contains("e1"));
        assert!(csv.contains("dress_rehearsal"));
    }
}
