use std::net::SocketAddr;
use std::sync::Arc;

use admin_api::handlers::AdminState;
use admin_api::{
    create_event, create_room, get_capabilities, health, list_events, require_bearer, update_event,
    InMemoryAdminStore,
};
use axum::middleware;
use axum::routing::{get, post, put};
use axum::Router;
use platform::Capabilities;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    std::env::set_var("ADMIN_DEV_AUTH", "1");
    let _ = tracing_subscriber::fmt().with_env_filter("info").try_init();
    let state = AdminState {
        store: Arc::new(InMemoryAdminStore::new()),
        tenant_id: "default".into(),
        capabilities: Capabilities::oss_full(),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/capabilities", get(get_capabilities))
        .route("/v1/rooms", post(create_room))
        .route("/v1/events", post(create_event).get(list_events))
        .route("/v1/events/{event_id}", put(update_event))
        .layer(middleware::from_fn(require_bearer))
        .layer(CorsLayer::permissive())
        .with_state(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    println!("admin-local on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
