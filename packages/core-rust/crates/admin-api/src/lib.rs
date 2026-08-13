//! Admin / control plane API (OSS full preset + SaaS).

pub mod auth;
pub mod dynamodb_store;
pub mod handlers;
pub mod store;

pub use auth::{auth_required, require_bearer};
pub use dynamodb_store::DynamoDbAdminStore;
pub use handlers::{
    create_event, create_room, event_stats, get_capabilities, health, list_events, list_rooms,
    ready, update_event, AdminState,
};
pub use store::{AdminError, AdminStore, EventStats, InMemoryAdminStore, LiveOverrides, Room};
