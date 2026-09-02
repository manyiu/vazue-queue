//! Queue data plane HTTP API.

pub mod aws_local;
pub mod dynamodb_store;
pub mod handlers;
pub mod lambda_runtime;
pub mod secrets;
pub mod state;
pub mod store;

#[cfg(test)]
mod test_env;

pub use dynamodb_store::DynamoDbStore;
pub use handlers::{active_event, admit, capabilities, enroll, health, ready, status};
pub use state::AppState;
pub use store::{EventStats, InMemoryStore, QueueStore};
