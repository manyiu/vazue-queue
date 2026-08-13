//! Queue kernel: FIFO positions, wait estimates, JWT admit tokens.

pub mod counters;
pub mod jwt;
pub mod models;
pub mod wait;

pub use counters::{assign_shard, merge_counter_shards, next_global_position, ShardPlan};
pub use jwt::{sign_admit_token, verify_admit_token, AdmitClaims, JwtKeys};
pub use models::{
    BotProtectionMode, EventConfig, QueueConfig, RoomConfig, VisitorRecord, VisitorStatus,
};
pub use wait::{adaptive_poll_interval_secs, estimate_wait_minutes};
