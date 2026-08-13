use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisitorStatus {
    Enrolled,
    Waiting,
    Admitted,
    Expired,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisitorRecord {
    pub tenant_id: String,
    pub event_id: String,
    pub request_id: String,
    pub session_id: String,
    pub position: u64,
    pub shard: u32,
    pub status: VisitorStatus,
    pub enrolled_at: i64,
    pub return_url: Option<String>,
    pub admit_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueConfig {
    pub default_throughput_per_minute: u32,
    pub counter_shards: u32,
    pub token_ttl_seconds: u64,
    pub visitor_record_ttl_hours: u32,
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            default_throughput_per_minute: 100,
            counter_shards: 8,
            token_ttl_seconds: 3600,
            visitor_record_ttl_hours: 24,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomConfig {
    pub room_id: String,
    pub theme: serde_json::Value,
    pub queue: QueueConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventConfig {
    pub event_id: String,
    pub room_id: String,
    pub throughput_per_minute: u32,
    pub paused: bool,
    pub emergency_open: bool,
    pub invite_only: bool,
    pub bot_protection: BotProtectionMode,
    pub return_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BotProtectionMode {
    #[default]
    Off,
    RateLimitOnly,
    ChallengeSuspicious,
    ChallengeAlways,
}
