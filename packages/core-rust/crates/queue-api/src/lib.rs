//! Queue data plane HTTP API.

pub mod dynamodb_store;
pub mod handlers;
pub mod lambda_runtime;
pub mod state;
pub mod store;

pub use dynamodb_store::DynamoDbStore;
pub use handlers::{admit, capabilities, enroll, health, ready, status};
pub use state::AppState;
pub use store::{InMemoryStore, QueueStore};
