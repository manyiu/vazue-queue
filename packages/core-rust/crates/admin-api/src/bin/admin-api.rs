//! Lambda entry for admin / control plane HTTP API.

use std::sync::Arc;

use admin_api::handlers::AdminState;
use admin_api::{
    create_event, create_room, get_capabilities, health, list_events, update_event,
    InMemoryAdminStore,
};
use axum::routing::{get, post, put};
use axum::Router;
use lambda_http::{run, Error};
use platform::Capabilities;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .try_init();

    let state = AdminState {
        store: Arc::new(InMemoryAdminStore::new()),
        tenant_id: std::env::var("TENANT_ID").unwrap_or_else(|_| "default".into()),
        capabilities: Capabilities::oss_full(),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/capabilities", get(get_capabilities))
        .route("/v1/rooms", post(create_room))
        .route("/v1/events", post(create_event).get(list_events))
        .route("/v1/events/{event_id}", put(update_event))
        .route("/v1/events/{eventId}", put(update_event))
        .layer(CorsLayer::permissive())
        .with_state(state);

    run(app).await
}
