//! Dual local stack: queue API :3000 + admin API :3001 with shared in-memory events.

use std::net::SocketAddr;
use std::sync::Arc;

use admin_api::handlers::AdminState;
use admin_api::{
    create_event, create_room, event_stats, export_event, get_capabilities, health as admin_health,
    list_events, list_rooms, ready as admin_ready, require_bearer, update_event, update_room,
    AdminError, AdminStore, EventStats, InMemoryAdminStore, LiveOverrides, Room,
};
use async_trait::async_trait;
use axum::middleware;
use axum::routing::{get, post, put};
use axum::Router;
use platform::Capabilities;
use queue_api::{
    active_event, admit, capabilities, enroll, health, ready, status, AppState, InMemoryStore,
    QueueStore,
};
use queue_kernel::EventConfig;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

/// Admin store that mirrors event writes into the queue InMemoryStore.
struct BridgedAdminStore {
    admin: InMemoryAdminStore,
    queue: Arc<InMemoryStore>,
}

#[async_trait]
impl AdminStore for BridgedAdminStore {
    async fn create_room(&self, tenant_id: &str, room: Room) -> Result<Room, AdminError> {
        self.admin.create_room(tenant_id, room).await
    }

    async fn get_room(&self, tenant_id: &str, room_id: &str) -> Result<Room, AdminError> {
        self.admin.get_room(tenant_id, room_id).await
    }

    async fn list_rooms(&self, tenant_id: &str) -> Result<Vec<Room>, AdminError> {
        self.admin.list_rooms(tenant_id).await
    }

    async fn update_room(
        &self,
        tenant_id: &str,
        room_id: &str,
        room: Room,
    ) -> Result<Room, AdminError> {
        let updated = self.admin.update_room(tenant_id, room_id, room).await?;
        if let Some(active) = &updated.active_event_id {
            self.queue
                .set_active_event(tenant_id, room_id, active)
                .await
                .map_err(|e| AdminError::Message(e.to_string()))?;
        }
        Ok(updated)
    }

    async fn create_event(
        &self,
        tenant_id: &str,
        event: EventConfig,
    ) -> Result<EventConfig, AdminError> {
        let created = self.admin.create_event(tenant_id, event.clone()).await?;
        self.queue
            .ensure_event(tenant_id, created.clone())
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        if let Ok(room) = self.admin.get_room(tenant_id, &created.room_id).await {
            if let Some(active) = &room.active_event_id {
                self.queue
                    .set_active_event(tenant_id, &created.room_id, active)
                    .await
                    .map_err(|e| AdminError::Message(e.to_string()))?;
            }
        }
        Ok(created)
    }

    async fn list_events(&self, tenant_id: &str) -> Result<Vec<EventConfig>, AdminError> {
        self.admin.list_events(tenant_id).await
    }

    async fn update_event(
        &self,
        tenant_id: &str,
        event_id: &str,
        overrides: LiveOverrides,
    ) -> Result<EventConfig, AdminError> {
        let updated = self
            .admin
            .update_event(tenant_id, event_id, overrides)
            .await?;
        self.queue
            .ensure_event(tenant_id, updated.clone())
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        Ok(updated)
    }

    async fn event_stats(&self, tenant_id: &str, event_id: &str) -> Result<EventStats, AdminError> {
        let s = self
            .queue
            .event_stats(tenant_id, event_id)
            .await
            .map_err(|e| match e {
                queue_api::store::StoreError::NotFound => AdminError::NotFound,
                other => AdminError::Message(other.to_string()),
            })?;
        Ok(EventStats {
            event_id: s.event_id,
            serving: s.serving,
            queue_depth: s.queue_depth,
            waiting: s.waiting,
            admitted: s.admitted,
            throughput_per_minute: s.throughput_per_minute,
            paused: s.paused,
            emergency_open: s.emergency_open,
            dress_rehearsal: s.dress_rehearsal,
        })
    }
}

#[tokio::main]
async fn main() {
    std::env::set_var("VAZUE_LOCAL", "1");
    std::env::set_var("ADMIN_DEV_AUTH", "1");
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .try_init();

    let queue_store = Arc::new(InMemoryStore::new());
    let demo = EventConfig {
        event_id: "demo".into(),
        room_id: "default".into(),
        throughput_per_minute: 100,
        paused: false,
        emergency_open: false,
        dress_rehearsal: false,
        bot_protection: queue_kernel::BotProtectionMode::Off,
        return_url: Some("https://example.com/checkout".into()),
    };
    queue_store
        .ensure_event("default", demo.clone())
        .await
        .expect("seed demo");

    let admin_store = Arc::new(BridgedAdminStore {
        admin: InMemoryAdminStore::new(),
        queue: queue_store.clone(),
    });
    let _ = admin_store
        .create_room(
            "default",
            Room {
                room_id: "default".into(),
                name: "Default room".into(),
                theme: serde_json::json!({
                    "brandName": "Vazue Queue",
                    "message": "You're in line. Please keep this tab open."
                }),
                queue: queue_kernel::QueueConfig::default(),
                active_event_id: None,
            },
        )
        .await;
    let _ = admin_store.create_event("default", demo).await;
    let _ = queue_store
        .set_active_event("default", "default", "demo")
        .await;

    let queue_state = AppState::local(queue_store, b"local-dev-hmac-secret-change-me");
    let admin_state = AdminState {
        store: admin_store,
        tenant_id: "default".into(),
        capabilities: Capabilities::default(),
    };

    let queue_app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/rooms/{room_id}/active-event", get(active_event))
        .route("/v1/events/{event_id}/enroll", post(enroll))
        .route("/v1/events/{event_id}/status", get(status))
        .route("/v1/events/{event_id}/admit", post(admit))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(queue_state);

    let admin_app = Router::new()
        .route("/health", get(admin_health))
        .route("/ready", get(admin_ready))
        .route("/v1/capabilities", get(get_capabilities))
        .route("/v1/rooms", post(create_room).get(list_rooms))
        .route("/v1/rooms/{room_id}", put(update_room))
        .route("/v1/events", post(create_event).get(list_events))
        .route("/v1/events/{event_id}", put(update_event))
        .route("/v1/events/{event_id}/stats", get(event_stats))
        .route("/v1/events/{event_id}/export", get(export_event))
        .layer(middleware::from_fn(require_bearer))
        .layer(CorsLayer::permissive())
        .with_state(admin_state);

    let queue_addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let admin_addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    info!("queue local-server http://{queue_addr}");
    info!("admin local-server http://{admin_addr} (events sync into queue store)");

    let queue_listener = tokio::net::TcpListener::bind(queue_addr).await.unwrap();
    let admin_listener = tokio::net::TcpListener::bind(admin_addr).await.unwrap();

    tokio::select! {
        r = axum::serve(queue_listener, queue_app) => { r.unwrap(); }
        r = axum::serve(admin_listener, admin_app) => { r.unwrap(); }
    }
}
