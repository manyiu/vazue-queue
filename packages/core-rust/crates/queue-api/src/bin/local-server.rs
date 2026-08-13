use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use queue_api::{
    admit, capabilities, enroll, health, ready, status, AppState, InMemoryStore, QueueStore,
};
use queue_kernel::{BotProtectionMode, EventConfig};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber_init();
    let store = Arc::new(InMemoryStore::new());
    let event = EventConfig {
        event_id: "demo".into(),
        room_id: "default".into(),
        throughput_per_minute: 100,
        paused: false,
        emergency_open: false,
        invite_only: false,
        bot_protection: BotProtectionMode::Off,
        return_url: Some("https://example.com/checkout".into()),
    };
    store
        .ensure_event("default", event)
        .await
        .expect("seed event");

    let state = AppState::local(store, b"local-dev-hmac-secret-change-me");
    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/events/{event_id}/enroll", post(enroll))
        .route("/v1/events/{event_id}/status", get(status))
        .route("/v1/events/{event_id}/admit", post(admit))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("vazue-queue local-server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

fn tracing_subscriber_init() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .try_init();
}
