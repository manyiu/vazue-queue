//! DynamoDB-backed [`QueueStore`] for AWS Lambda deployments.

use crate::store::{
    ActiveEventResponse, EnrollRequest, EnrollResponse, EventStats, QueueStore, StatusResponse,
    StoreError,
};
use async_trait::async_trait;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_dynamodb::Client;
use chrono::Utc;
use queue_kernel::{
    adaptive_poll_interval_secs, assign_shard, estimate_wait_minutes, sign_admit_token,
    BotProtectionMode, EventConfig, JwtKeys, QueueConfig, ShardPlan, VisitorRecord, VisitorStatus,
};
use std::collections::HashMap;
use std::env;
use uuid::Uuid;

pub struct DynamoDbStore {
    client: Client,
    events_table: String,
    visitors_table: String,
    counters_table: String,
    rooms_table: String,
    queue: QueueConfig,
}

impl DynamoDbStore {
    pub fn from_env(client: Client) -> Result<Self, StoreError> {
        Ok(Self {
            client,
            events_table: env::var("EVENTS_TABLE")
                .map_err(|_| StoreError::Message("EVENTS_TABLE required".into()))?,
            visitors_table: env::var("VISITORS_TABLE")
                .map_err(|_| StoreError::Message("VISITORS_TABLE required".into()))?,
            counters_table: env::var("COUNTERS_TABLE")
                .map_err(|_| StoreError::Message("COUNTERS_TABLE required".into()))?,
            rooms_table: env::var("ROOMS_TABLE")
                .map_err(|_| StoreError::Message("ROOMS_TABLE required".into()))?,
            queue: QueueConfig {
                counter_shards: env::var("COUNTER_SHARDS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(8),
                token_ttl_seconds: env::var("TOKEN_TTL_SECONDS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(3600),
                visitor_record_ttl_hours: env::var("VISITOR_TTL_HOURS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(24),
                ..QueueConfig::default()
            },
        })
    }

    fn av_s(v: impl Into<String>) -> AttributeValue {
        AttributeValue::S(v.into())
    }

    fn av_n(v: impl ToString) -> AttributeValue {
        AttributeValue::N(v.to_string())
    }

    fn get_s(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
        item.get(key).and_then(|v| v.as_s().ok()).cloned()
    }

    fn get_n_u64(item: &HashMap<String, AttributeValue>, key: &str) -> Option<u64> {
        item.get(key)
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse().ok())
    }

    fn get_n_i64(item: &HashMap<String, AttributeValue>, key: &str) -> Option<i64> {
        item.get(key)
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse().ok())
    }

    fn get_bool(item: &HashMap<String, AttributeValue>, key: &str) -> bool {
        item.get(key)
            .and_then(|v| v.as_bool().ok())
            .copied()
            .unwrap_or(false)
    }

    fn event_from_item(item: &HashMap<String, AttributeValue>) -> Result<EventConfig, StoreError> {
        let bot = match Self::get_s(item, "botProtection")
            .unwrap_or_else(|| "off".into())
            .as_str()
        {
            "rate_limit_only" => BotProtectionMode::RateLimitOnly,
            "challenge_suspicious" => BotProtectionMode::ChallengeSuspicious,
            "challenge_always" => BotProtectionMode::ChallengeAlways,
            _ => BotProtectionMode::Off,
        };
        Ok(EventConfig {
            event_id: Self::get_s(item, "eventId").ok_or(StoreError::NotFound)?,
            room_id: Self::get_s(item, "roomId").unwrap_or_default(),
            throughput_per_minute: Self::get_n_u64(item, "throughputPerMinute").unwrap_or(100)
                as u32,
            paused: Self::get_bool(item, "paused"),
            emergency_open: Self::get_bool(item, "emergencyOpen"),
            dress_rehearsal: Self::get_bool(item, "dressRehearsal"),
            bot_protection: bot,
            return_url: Self::get_s(item, "returnUrl"),
        })
    }

    fn visitor_from_item(
        item: &HashMap<String, AttributeValue>,
    ) -> Result<VisitorRecord, StoreError> {
        let status = match Self::get_s(item, "status")
            .unwrap_or_else(|| "waiting".into())
            .as_str()
        {
            "admitted" => VisitorStatus::Admitted,
            "expired" => VisitorStatus::Expired,
            "blocked" => VisitorStatus::Blocked,
            "enrolled" => VisitorStatus::Enrolled,
            _ => VisitorStatus::Waiting,
        };
        Ok(VisitorRecord {
            event_id: Self::get_s(item, "eventId").ok_or(StoreError::NotFound)?,
            request_id: Self::get_s(item, "requestId").ok_or(StoreError::NotFound)?,
            session_id: Self::get_s(item, "sessionId").unwrap_or_default(),
            position: Self::get_n_u64(item, "position").unwrap_or(0),
            shard: Self::get_n_u64(item, "shard").unwrap_or(0) as u32,
            status,
            enrolled_at: Self::get_n_i64(item, "enrolledAt").unwrap_or(0),
            return_url: Self::get_s(item, "returnUrl"),
            admit_token: Self::get_s(item, "admitToken"),
        })
    }

    async fn get_counter(&self, event_id: &str, counter_type: &str) -> Result<u64, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.counters_table)
            .key("eventId", Self::av_s(event_id))
            .key("counterType", Self::av_s(counter_type))
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;
        Ok(out
            .item
            .as_ref()
            .and_then(|i| Self::get_n_u64(i, "value"))
            .unwrap_or(0))
    }

    async fn add_counter(
        &self,
        event_id: &str,
        counter_type: &str,
        delta: i64,
    ) -> Result<u64, StoreError> {
        let out = self
            .client
            .update_item()
            .table_name(&self.counters_table)
            .key("eventId", Self::av_s(event_id))
            .key("counterType", Self::av_s(counter_type))
            .update_expression("ADD #v :d")
            .expression_attribute_names("#v", "value")
            .expression_attribute_values(":d", Self::av_n(delta))
            .return_values(aws_sdk_dynamodb::types::ReturnValue::UpdatedNew)
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;
        Ok(out
            .attributes
            .as_ref()
            .and_then(|i| Self::get_n_u64(i, "value"))
            .unwrap_or(0))
    }

    async fn load_visitor(
        &self,
        event_id: &str,
        request_id: &str,
    ) -> Result<VisitorRecord, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.visitors_table)
            .key("eventId", Self::av_s(event_id))
            .key("requestId", Self::av_s(request_id))
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let item = out.item.ok_or(StoreError::NotFound)?;
        Self::visitor_from_item(&item)
    }

    async fn maybe_admit(
        &self,
        tenant_id: &str,
        event_id: &str,
        request_id: &str,
        keys: &JwtKeys,
        use_rsa: bool,
    ) -> Result<StatusResponse, StoreError> {
        let event = self.get_event(tenant_id, event_id).await?;
        let mut visitor = self.load_visitor(event_id, request_id).await?;
        let serving = self.get_counter(event_id, "serving").await?;
        let should_admit = event.emergency_open || visitor.position <= serving;

        if should_admit && visitor.admit_token.is_none() {
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
            self.client
                .update_item()
                .table_name(&self.visitors_table)
                .key("eventId", Self::av_s(event_id))
                .key("requestId", Self::av_s(request_id))
                .update_expression("SET admitToken = :t, #s = :st")
                .expression_attribute_names("#s", "status")
                .expression_attribute_values(":t", Self::av_s(&token))
                .expression_attribute_values(":st", Self::av_s("admitted"))
                .send()
                .await
                .map_err(|e| StoreError::Message(e.to_string()))?;

            if visitor.position > serving {
                let _ = self
                    .add_counter(event_id, "serving", (visitor.position - serving) as i64)
                    .await;
            }
            visitor.admit_token = Some(token);
            visitor.status = VisitorStatus::Admitted;
        }

        let serving = self.get_counter(event_id, "serving").await?;
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

#[async_trait]
impl QueueStore for DynamoDbStore {
    async fn ensure_event(&self, tenant_id: &str, event: EventConfig) -> Result<(), StoreError> {
        let bot = match event.bot_protection {
            BotProtectionMode::Off => "off",
            BotProtectionMode::RateLimitOnly => "rate_limit_only",
            BotProtectionMode::ChallengeSuspicious => "challenge_suspicious",
            BotProtectionMode::ChallengeAlways => "challenge_always",
        };
        let mut item = HashMap::from([
            ("tenantId".into(), Self::av_s(tenant_id)),
            ("eventId".into(), Self::av_s(&event.event_id)),
            ("roomId".into(), Self::av_s(&event.room_id)),
            (
                "throughputPerMinute".into(),
                Self::av_n(event.throughput_per_minute),
            ),
            ("paused".into(), AttributeValue::Bool(event.paused)),
            (
                "emergencyOpen".into(),
                AttributeValue::Bool(event.emergency_open),
            ),
            (
                "dressRehearsal".into(),
                AttributeValue::Bool(event.dress_rehearsal),
            ),
            ("botProtection".into(), Self::av_s(bot)),
        ]);
        if let Some(url) = &event.return_url {
            item.insert("returnUrl".into(), Self::av_s(url));
        }
        self.client
            .put_item()
            .table_name(&self.events_table)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;
        Ok(())
    }

    async fn get_event(&self, tenant_id: &str, event_id: &str) -> Result<EventConfig, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.events_table)
            .key("tenantId", Self::av_s(tenant_id))
            .key("eventId", Self::av_s(event_id))
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let item = out.item.ok_or(StoreError::NotFound)?;
        Self::event_from_item(&item)
    }

    async fn active_event(
        &self,
        tenant_id: &str,
        room_id: &str,
    ) -> Result<ActiveEventResponse, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.rooms_table)
            .key("tenantId", Self::av_s(tenant_id))
            .key("roomId", Self::av_s(room_id))
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;
        let item = out.item.ok_or(StoreError::NotFound)?;
        let event_id = Self::get_s(&item, "activeEventId").ok_or(StoreError::NotFound)?;
        let event = self.get_event(tenant_id, &event_id).await?;
        Ok(ActiveEventResponse {
            room_id: room_id.to_string(),
            event_id: event.event_id.clone(),
            return_url: event.return_url.clone(),
            dress_rehearsal: event.dress_rehearsal,
            paused: event.paused,
        })
    }

    async fn event_stats(&self, tenant_id: &str, event_id: &str) -> Result<EventStats, StoreError> {
        let event = self.get_event(tenant_id, event_id).await?;
        let serving = self.get_counter(event_id, "serving").await?;
        let queue_depth = self.get_counter(event_id, "queue#global").await?;
        let waiting = queue_depth.saturating_sub(serving);
        Ok(EventStats {
            event_id: event.event_id.clone(),
            serving,
            queue_depth,
            waiting,
            admitted: serving.min(queue_depth),
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
        let event = self.get_event(tenant_id, &req.event_id).await?;
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

        // Idempotent lookup via GSI bySession when present; fall back to query.
        let existing = self
            .client
            .query()
            .table_name(&self.visitors_table)
            .index_name("bySession")
            .key_condition_expression("eventId = :e AND sessionId = :s")
            .expression_attribute_values(":e", Self::av_s(&req.event_id))
            .expression_attribute_values(":s", Self::av_s(&session_id))
            .limit(1)
            .send()
            .await;

        if let Ok(out) = existing {
            if let Some(items) = out.items {
                if let Some(item) = items.into_iter().next() {
                    let v = Self::visitor_from_item(&item)?;
                    return Ok(EnrollResponse {
                        request_id: v.request_id,
                        session_id: v.session_id,
                        position: v.position,
                        status: v.status,
                    });
                }
            }
        } else {
            // Index may be missing in local/dev — fall back to event query.
            let existing = self
                .client
                .query()
                .table_name(&self.visitors_table)
                .key_condition_expression("eventId = :e")
                .expression_attribute_values(":e", Self::av_s(&req.event_id))
                .send()
                .await
                .map_err(|e| StoreError::Message(e.to_string()))?;
            if let Some(items) = existing.items {
                for item in items {
                    if Self::get_s(&item, "sessionId").as_deref() == Some(session_id.as_str()) {
                        let v = Self::visitor_from_item(&item)?;
                        return Ok(EnrollResponse {
                            request_id: v.request_id,
                            session_id: v.session_id,
                            position: v.position,
                            status: v.status,
                        });
                    }
                }
            }
        }

        let plan = ShardPlan::new(self.queue.counter_shards);
        let shard = assign_shard(&session_id, plan);
        let shard_key = format!("queue#shard{shard}");
        let _ = self.add_counter(&req.event_id, &shard_key, 1).await?;
        // Atomic global FIFO position via ADD on queue#global.
        let position = self.add_counter(&req.event_id, "queue#global", 1).await?;

        let request_id = req
            .request_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let enrolled_at = Utc::now().timestamp();
        let ttl = enrolled_at + (self.queue.visitor_record_ttl_hours as i64) * 3600;
        let return_url = req.return_url.or(event.return_url);
        let mut item = HashMap::from([
            ("eventId".into(), Self::av_s(&req.event_id)),
            ("requestId".into(), Self::av_s(&request_id)),
            ("sessionId".into(), Self::av_s(&session_id)),
            ("position".into(), Self::av_n(position)),
            ("shard".into(), Self::av_n(shard)),
            ("status".into(), Self::av_s("waiting")),
            ("enrolledAt".into(), Self::av_n(enrolled_at)),
            ("ttl".into(), Self::av_n(ttl)),
        ]);
        if let Some(url) = &return_url {
            item.insert("returnUrl".into(), Self::av_s(url));
        }
        self.client
            .put_item()
            .table_name(&self.visitors_table)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| StoreError::Message(e.to_string()))?;

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
        let event = self.get_event(tenant_id, event_id).await?;
        // Advance serving by one minute of configured throughput (EventBridge rate = 1 min).
        let slice = u64::from(event.throughput_per_minute.max(1));
        let advanced = self.add_counter(event_id, "serving", slice as i64).await?;
        Ok(slice.min(advanced))
    }
}
