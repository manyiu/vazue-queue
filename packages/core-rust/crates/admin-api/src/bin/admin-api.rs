//! Lambda entry for admin / control plane HTTP API.

use std::sync::Arc;

use admin_api::handlers::AdminState;
use admin_api::{
    create_event, create_room, event_stats, export_event, get_capabilities, health, list_events,
    list_rooms, ready, require_bearer, update_event, update_room, DynamoDbAdminStore,
    InMemoryAdminStore,
};
use aws_config::BehaviorVersion;
use axum::middleware;
use axum::routing::{get, post, put};
use axum::Router;
use lambda_http::{run, Error};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .try_init();

    let tenant_id = std::env::var("TENANT_ID").unwrap_or_else(|_| "default".into());
    let store: Arc<dyn admin_api::AdminStore> = if std::env::var("ROOMS_TABLE").is_ok() {
        let conf = aws_config::load_defaults(BehaviorVersion::latest()).await;
        let ddb = aws_sdk_dynamodb::Client::new(&conf);
        Arc::new(DynamoDbAdminStore::from_env(ddb).map_err(|e| Error::from(e.to_string()))?)
    } else {
        Arc::new(InMemoryAdminStore::new())
    };

    let state = AdminState {
        store,
        tenant_id,
        capabilities: platform::Capabilities::default(),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/v1/capabilities", get(get_capabilities))
        .route("/v1/rooms", post(create_room).get(list_rooms))
        .route("/v1/rooms/{room_id}", put(update_room))
        .route("/v1/rooms/{roomId}", put(update_room))
        .route("/v1/events", post(create_event).get(list_events))
        .route("/v1/events/{event_id}", put(update_event))
        .route("/v1/events/{eventId}", put(update_event))
        .route("/v1/events/{event_id}/stats", get(event_stats))
        .route("/v1/events/{eventId}/stats", get(event_stats))
        .route("/v1/events/{event_id}/export", get(export_event))
        .route("/v1/events/{eventId}/export", get(export_event))
        .layer(middleware::from_fn(require_bearer))
        .layer(CorsLayer::permissive())
        .with_state(state);

    run(app).await
}
