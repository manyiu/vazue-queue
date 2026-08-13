//! Admin / control plane API (OSS full preset + SaaS).

pub mod dynamodb_store;
pub mod handlers;
pub mod store;

pub use dynamodb_store::DynamoDbAdminStore;
pub use handlers::{
    create_event, create_room, get_capabilities, health, list_events, update_event, AdminState,
};
pub use store::{AdminStore, InMemoryAdminStore, LiveOverrides, Room};
