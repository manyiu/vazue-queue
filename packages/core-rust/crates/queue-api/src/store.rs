use async_trait::async_trait;
use chrono::Utc;
use queue_kernel::{
    assign_shard, next_global_position, sign_admit_token, BotProtectionMode, EventConfig, JwtKeys,
    QueueConfig, ShardPlan, VisitorRecord, VisitorStatus,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("{0}")]
    Message(String),
    #[error("not found")]
    NotFound,
    #[error("conflict: {0}")]
    Conflict(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollRequest {
    #[serde(default)]
    pub event_id: String,
    /// When set (async enroll buffer), store uses this id instead of generating one.
    pub request_id: Option<String>,
    pub session_id: Option<String>,
    pub return_url: Option<String>,
    pub turnstile_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollResponse {
    pub request_id: String,
    pub session_id: String,
    pub position: u64,
    pub status: VisitorStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub request_id: String,
    pub position: u64,
    pub serving: u64,
    pub wait_estimate_minutes: f64,
    pub poll_after_seconds: u64,
    pub status: VisitorStatus,
    pub admitted: bool,
    pub admit_token: Option<String>,
    pub return_url: Option<String>,
    #[serde(default)]
    pub dress_rehearsal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventStats {
    pub event_id: String,
    pub serving: u64,
    pub queue_depth: u64,
    pub waiting: u64,
    pub admitted: u64,
    pub throughput_per_minute: u32,
    pub paused: bool,
    pub emergency_open: bool,
    pub dress_rehearsal: bool,
}

#[async_trait]
pub trait QueueStore: Send + Sync {
    async fn ensure_event(&self, tenant_id: &str, event: EventConfig) -> Result<(), StoreError>;
    async fn get_event(&self, tenant_id: &str, event_id: &str) -> Result<EventConfig, StoreError>;
    async fn event_stats(&self, tenant_id: &str, event_id: &str) -> Result<EventStats, StoreError>;
    async fn enroll(
        &self,
        tenant_id: &str,
        req: EnrollRequest,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<EnrollResponse, StoreError>;
    async fn status(
        &self,
        tenant_id: &str,
        event_id: &str,
        request_id: &str,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<StatusResponse, StoreError>;
    async fn admit(
        &self,
        tenant_id: &str,
        event_id: &str,
        request_id: &str,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<StatusResponse, StoreError>;
    async fn reaper_tick(&self, tenant_id: &str, event_id: &str) -> Result<u64, StoreError>;
}

#[derive(Default)]
struct MemInner {
    events: HashMap<String, EventConfig>,
    visitors: HashMap<String, VisitorRecord>,
    session_index: HashMap<String, String>, // tenant|event|session -> request_id
    queue_counter: HashMap<String, u64>,
    serving_counter: HashMap<String, u64>,
}

pub struct InMemoryStore {
    inner: Mutex<MemInner>,
    queue: QueueConfig,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(MemInner::default()),
            queue: QueueConfig::default(),
        }
    }

    fn event_key(tenant_id: &str, event_id: &str) -> String {
        format!("{tenant_id}|{event_id}")
    }
}

impl Default for InMemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl QueueStore for InMemoryStore {
    async fn ensure_event(&self, tenant_id: &str, event: EventConfig) -> Result<(), StoreError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let key = Self::event_key(tenant_id, &event.event_id);
        g.events.insert(key.clone(), event);
        g.queue_counter.entry(key.clone()).or_insert(0);
        g.serving_counter.entry(key).or_insert(0);
        Ok(())
    }

    async fn get_event(&self, tenant_id: &str, event_id: &str) -> Result<EventConfig, StoreError> {
        let g = self
            .inner
            .lock()
            .map_err(|e| StoreError::Message(e.to_string()))?;
        g.events
            .get(&Self::event_key(tenant_id, event_id))
            .cloned()
            .ok_or(StoreError::NotFound)
    }

    async fn event_stats(&self, tenant_id: &str, event_id: &str) -> Result<EventStats, StoreError> {
        let g = self
            .inner
            .lock()
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let ek = Self::event_key(tenant_id, event_id);
        let event = g.events.get(&ek).cloned().ok_or(StoreError::NotFound)?;
        let serving = *g.serving_counter.get(&ek).unwrap_or(&0);
        let queue_depth = *g.queue_counter.get(&ek).unwrap_or(&0);
        let mut waiting = 0u64;
        let mut admitted = 0u64;
        for v in g.visitors.values() {
            if v.event_id == event_id {
                match v.status {
                    VisitorStatus::Waiting | VisitorStatus::Enrolled => waiting += 1,
                    VisitorStatus::Admitted => admitted += 1,
                    _ => {}
                }
            }
        }
        Ok(EventStats {
            event_id: event.event_id.clone(),
            serving,
            queue_depth,
            waiting,
            admitted,
            throughput_per_minute: event.throughput_per_minute,
            paused: event.paused,
            emergency_open: event.emergency_open,
            dress_rehearsal: event.dress_rehearsal,
        })
    }

    async fn enroll(
        &self,
        tenant_id: &str,
        req: EnrollRequest,
        _keys: &JwtKeys,
        _use_rsa: bool,
    ) -> Result<EnrollResponse, StoreError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let ek = Self::event_key(tenant_id, &req.event_id);
        let event = g.events.get(&ek).cloned().ok_or(StoreError::NotFound)?;

        if event.paused && !event.emergency_open {
            return Err(StoreError::Conflict("queue paused".into()));
        }

        if matches!(event.bot_protection, BotProtectionMode::ChallengeAlways)
            && req.turnstile_token.as_deref().unwrap_or("").is_empty()
        {
            return Err(StoreError::Conflict("captcha required".into()));
        }

        let session_id = req
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let sk = format!("{ek}|{session_id}");
        if let Some(existing) = g.session_index.get(&sk) {
            let v = g.visitors.get(existing).ok_or(StoreError::NotFound)?;
            return Ok(EnrollResponse {
                request_id: v.request_id.clone(),
                session_id: v.session_id.clone(),
                position: v.position,
                status: v.status,
            });
        }

        let plan = ShardPlan::new(self.queue.counter_shards);
        let shard = assign_shard(&session_id, plan);
        let counter = g.queue_counter.entry(ek.clone()).or_insert(0);
        *counter = next_global_position(*counter);
        let position = *counter;
        let request_id = req
            .request_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let record = VisitorRecord {
            event_id: req.event_id.clone(),
            request_id: request_id.clone(),
            session_id: session_id.clone(),
            position,
            shard,
            status: VisitorStatus::Waiting,
            enrolled_at: Utc::now().timestamp(),
            return_url: req.return_url.or(event.return_url.clone()),
            admit_token: None,
        };
        g.session_index.insert(sk, request_id.clone());
        g.visitors.insert(request_id.clone(), record);
        Ok(EnrollResponse {
            request_id,
            session_id,
            position,
            status: VisitorStatus::Waiting,
        })
    }

    async fn status(
        &self,
        tenant_id: &str,
        event_id: &str,
        request_id: &str,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<StatusResponse, StoreError> {
        self.maybe_admit(tenant_id, event_id, request_id, keys, use_rsa)
            .await
    }

    async fn admit(
        &self,
        tenant_id: &str,
        event_id: &str,
        request_id: &str,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<StatusResponse, StoreError> {
        self.maybe_admit(tenant_id, event_id, request_id, keys, use_rsa)
            .await
    }

    async fn reaper_tick(&self, tenant_id: &str, event_id: &str) -> Result<u64, StoreError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let ek = Self::event_key(tenant_id, event_id);
        let event = g.events.get(&ek).cloned().ok_or(StoreError::NotFound)?;
        let now = Utc::now().timestamp();
        let ttl = (self.queue.visitor_record_ttl_hours as i64) * 3600;
        let serving = *g.serving_counter.get(&ek).unwrap_or(&0);
        let mut abandoned = 0u64;
        for v in g.visitors.values_mut() {
            if v.event_id == event_id
                && matches!(v.status, VisitorStatus::Waiting)
                && now - v.enrolled_at > ttl
            {
                v.status = VisitorStatus::Expired;
                if v.position <= serving + 1 {
                    abandoned += 1;
                }
            }
        }
        let slice = u64::from(event.throughput_per_minute.max(1));
        let s = g.serving_counter.entry(ek).or_insert(0);
        *s += slice + abandoned;
        Ok(slice + abandoned)
    }
}

impl InMemoryStore {
    async fn maybe_admit(
        &self,
        tenant_id: &str,
        event_id: &str,
        request_id: &str,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<StatusResponse, StoreError> {
        use queue_kernel::{adaptive_poll_interval_secs, estimate_wait_minutes};

        let mut g = self
            .inner
            .lock()
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let ek = Self::event_key(tenant_id, event_id);
        let event = g.events.get(&ek).cloned().ok_or(StoreError::NotFound)?;
        let serving = *g.serving_counter.get(&ek).unwrap_or(&0);
        let position = {
            let visitor = g.visitors.get(request_id).ok_or(StoreError::NotFound)?;
            visitor.position
        };
        let should_admit = event.emergency_open || position <= serving;

        if should_admit {
            let visitor = g.visitors.get_mut(request_id).ok_or(StoreError::NotFound)?;
            if visitor.admit_token.is_none() {
                let token = sign_admit_token(
                    keys,
                    tenant_id,
                    event_id,
                    request_id,
                    visitor.return_url.clone(),
                    self.queue.token_ttl_seconds as i64,
                    use_rsa,
                )
                .map_err(|e| StoreError::Message(e.to_string()))?;
                visitor.admit_token = Some(token);
                visitor.status = VisitorStatus::Admitted;
                let pos = visitor.position;
                let s = g.serving_counter.entry(ek.clone()).or_insert(0);
                if *s < pos {
                    *s = pos;
                }
            }
        }

        let visitor = g.visitors.get(request_id).ok_or(StoreError::NotFound)?;
        let serving = *g.serving_counter.get(&ek).unwrap_or(&0);
        let admitted = matches!(visitor.status, VisitorStatus::Admitted);
        Ok(StatusResponse {
            request_id: visitor.request_id.clone(),
            position: visitor.position,
            serving,
            wait_estimate_minutes: estimate_wait_minutes(
                visitor.position,
                serving,
                event.throughput_per_minute,
            ),
            poll_after_seconds: adaptive_poll_interval_secs(visitor.position, serving),
            status: visitor.status,
            admitted,
            admit_token: visitor.admit_token.clone(),
            return_url: visitor.return_url.clone(),
            dress_rehearsal: event.dress_rehearsal,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use queue_kernel::{EventConfig, JwtKeys};

    #[tokio::test]
    async fn enroll_status_admits_on_emergency_open() {
        let store = InMemoryStore::new();
        let keys = JwtKeys::from_hmac_secret(b"test-secret-key-32-bytes-long!!");
        store
            .ensure_event(
                "t1",
                EventConfig {
                    event_id: "e1".into(),
                    room_id: "r1".into(),
                    throughput_per_minute: 60,
                    paused: false,
                    emergency_open: true,
                    dress_rehearsal: false,
                    bot_protection: BotProtectionMode::Off,
                    return_url: Some("https://example.com".into()),
                },
            )
            .await
            .unwrap();

        let enrolled = store
            .enroll(
                "t1",
                EnrollRequest {
                    event_id: "e1".into(),
                    request_id: None,
                    session_id: Some("s1".into()),
                    return_url: None,
                    turnstile_token: None,
                },
                &keys,
                false,
            )
            .await
            .unwrap();
        assert_eq!(enrolled.position, 1);

        let status = store
            .status("t1", "e1", &enrolled.request_id, &keys, false)
            .await
            .unwrap();
        assert!(status.admitted);
        assert!(status.admit_token.is_some());
    }

    #[tokio::test]
    async fn enroll_is_idempotent_by_session() {
        let store = InMemoryStore::new();
        let keys = JwtKeys::from_hmac_secret(b"test-secret-key-32-bytes-long!!");
        store
            .ensure_event(
                "t1",
                EventConfig {
                    event_id: "e1".into(),
                    room_id: "r1".into(),
                    throughput_per_minute: 60,
                    paused: false,
                    emergency_open: false,
                    dress_rehearsal: false,
                    bot_protection: BotProtectionMode::Off,
                    return_url: None,
                },
            )
            .await
            .unwrap();
        let a = store
            .enroll(
                "t1",
                EnrollRequest {
                    event_id: "e1".into(),
                    request_id: None,
                    session_id: Some("same".into()),
                    return_url: None,
                    turnstile_token: None,
                },
                &keys,
                false,
            )
            .await
            .unwrap();
        let b = store
            .enroll(
                "t1",
                EnrollRequest {
                    event_id: "e1".into(),
                    request_id: None,
                    session_id: Some("same".into()),
                    return_url: None,
                    turnstile_token: None,
                },
                &keys,
                false,
            )
            .await
            .unwrap();
        assert_eq!(a.request_id, b.request_id);
        assert_eq!(a.position, b.position);
    }

    #[tokio::test]
    async fn reaper_advances_serving_by_throughput() {
        let store = InMemoryStore::new();
        let keys = JwtKeys::from_hmac_secret(b"test-secret-key-32-bytes-long!!");
        store
            .ensure_event(
                "t1",
                EventConfig {
                    event_id: "e1".into(),
                    room_id: "r1".into(),
                    throughput_per_minute: 30,
                    paused: false,
                    emergency_open: false,
                    dress_rehearsal: false,
                    bot_protection: BotProtectionMode::Off,
                    return_url: None,
                },
            )
            .await
            .unwrap();
        let enrolled = store
            .enroll(
                "t1",
                EnrollRequest {
                    event_id: "e1".into(),
                    request_id: None,
                    session_id: Some("s1".into()),
                    return_url: None,
                    turnstile_token: None,
                },
                &keys,
                false,
            )
            .await
            .unwrap();
        assert_eq!(enrolled.position, 1);
        let before = store
            .status("t1", "e1", &enrolled.request_id, &keys, false)
            .await
            .unwrap();
        assert!(!before.admitted);
        let advanced = store.reaper_tick("t1", "e1").await.unwrap();
        assert!(advanced >= 30);
        let after = store
            .status("t1", "e1", &enrolled.request_id, &keys, false)
            .await
            .unwrap();
        assert!(after.admitted);
        assert!(after.admit_token.is_some());
        assert!(after.serving >= 30);
    }

    #[tokio::test]
    async fn paused_queue_rejects_enroll() {
        let store = InMemoryStore::new();
        let keys = JwtKeys::from_hmac_secret(b"test-secret-key-32-bytes-long!!");
        store
            .ensure_event(
                "t1",
                EventConfig {
                    event_id: "e1".into(),
                    room_id: "r1".into(),
                    throughput_per_minute: 10,
                    paused: true,
                    emergency_open: false,
                    dress_rehearsal: false,
                    bot_protection: BotProtectionMode::Off,
                    return_url: None,
                },
            )
            .await
            .unwrap();
        let err = store
            .enroll(
                "t1",
                EnrollRequest {
                    event_id: "e1".into(),
                    request_id: None,
                    session_id: None,
                    return_url: None,
                    turnstile_token: None,
                },
                &keys,
                false,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[tokio::test]
    async fn enroll_honors_preassigned_request_id() {
        let store = InMemoryStore::new();
        let keys = JwtKeys::from_hmac_secret(b"test-secret-key-32-bytes-long!!");
        store
            .ensure_event(
                "t1",
                EventConfig {
                    event_id: "e1".into(),
                    room_id: "r1".into(),
                    throughput_per_minute: 10,
                    paused: false,
                    emergency_open: false,
                    dress_rehearsal: false,
                    bot_protection: BotProtectionMode::Off,
                    return_url: None,
                },
            )
            .await
            .unwrap();
        let enrolled = store
            .enroll(
                "t1",
                EnrollRequest {
                    event_id: "e1".into(),
                    request_id: Some("fixed-req".into()),
                    session_id: Some("s-fixed".into()),
                    return_url: None,
                    turnstile_token: None,
                },
                &keys,
                false,
            )
            .await
            .unwrap();
        assert_eq!(enrolled.request_id, "fixed-req");
        assert_eq!(enrolled.session_id, "s-fixed");
    }
}
