//! DynamoDB-backed admin store for AWS Lambda.

use crate::store::{AdminError, AdminStore, LiveOverrides, Room};
use async_trait::async_trait;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_dynamodb::Client;
use queue_kernel::{BotProtectionMode, EventConfig, QueueConfig};
use std::collections::HashMap;
use std::env;
use uuid::Uuid;

pub struct DynamoDbAdminStore {
    client: Client,
    rooms_table: String,
    events_table: String,
}

impl DynamoDbAdminStore {
    pub fn from_env(client: Client) -> Result<Self, AdminError> {
        Ok(Self {
            client,
            rooms_table: env::var("ROOMS_TABLE")
                .map_err(|_| AdminError::Message("ROOMS_TABLE required".into()))?,
            events_table: env::var("EVENTS_TABLE")
                .map_err(|_| AdminError::Message("EVENTS_TABLE required".into()))?,
        })
    }

    fn s(v: impl Into<String>) -> AttributeValue {
        AttributeValue::S(v.into())
    }

    fn n(v: impl ToString) -> AttributeValue {
        AttributeValue::N(v.to_string())
    }

    fn get_s(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
        item.get(key).and_then(|v| v.as_s().ok()).cloned()
    }

    fn get_n_u32(item: &HashMap<String, AttributeValue>, key: &str) -> Option<u32> {
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

    fn bot_from(s: &str) -> BotProtectionMode {
        match s {
            "rate_limit_only" => BotProtectionMode::RateLimitOnly,
            "challenge_suspicious" => BotProtectionMode::ChallengeSuspicious,
            "challenge_always" => BotProtectionMode::ChallengeAlways,
            _ => BotProtectionMode::Off,
        }
    }

    fn bot_to(m: BotProtectionMode) -> &'static str {
        match m {
            BotProtectionMode::Off => "off",
            BotProtectionMode::RateLimitOnly => "rate_limit_only",
            BotProtectionMode::ChallengeSuspicious => "challenge_suspicious",
            BotProtectionMode::ChallengeAlways => "challenge_always",
        }
    }

    fn event_from_item(item: &HashMap<String, AttributeValue>) -> Result<EventConfig, AdminError> {
        Ok(EventConfig {
            event_id: Self::get_s(item, "eventId").ok_or(AdminError::NotFound)?,
            room_id: Self::get_s(item, "roomId").unwrap_or_default(),
            throughput_per_minute: Self::get_n_u32(item, "throughputPerMinute").unwrap_or(100),
            paused: Self::get_bool(item, "paused"),
            emergency_open: Self::get_bool(item, "emergencyOpen"),
            invite_only: Self::get_bool(item, "inviteOnly"),
            bot_protection: Self::bot_from(
                &Self::get_s(item, "botProtection").unwrap_or_else(|| "off".into()),
            ),
            return_url: Self::get_s(item, "returnUrl"),
        })
    }

    fn room_from_item(item: &HashMap<String, AttributeValue>) -> Result<Room, AdminError> {
        let theme = Self::get_s(item, "themeJson")
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let queue = QueueConfig {
            default_throughput_per_minute: Self::get_n_u32(item, "defaultThroughput")
                .unwrap_or(100),
            counter_shards: Self::get_n_u32(item, "counterShards").unwrap_or(8),
            token_ttl_seconds: Self::get_n_u32(item, "tokenTtlSeconds").unwrap_or(3600) as u64,
            visitor_record_ttl_hours: Self::get_n_u32(item, "visitorTtlHours").unwrap_or(24),
        };
        Ok(Room {
            room_id: Self::get_s(item, "roomId").ok_or(AdminError::NotFound)?,
            name: Self::get_s(item, "name").unwrap_or_default(),
            theme,
            queue,
        })
    }
}

#[async_trait]
impl AdminStore for DynamoDbAdminStore {
    async fn create_room(&self, tenant_id: &str, mut room: Room) -> Result<Room, AdminError> {
        if room.room_id.is_empty() {
            room.room_id = Uuid::new_v4().to_string();
        }
        self.client
            .put_item()
            .table_name(&self.rooms_table)
            .set_item(Some(HashMap::from([
                ("tenantId".into(), Self::s(tenant_id)),
                ("roomId".into(), Self::s(&room.room_id)),
                ("name".into(), Self::s(&room.name)),
                (
                    "themeJson".into(),
                    Self::s(serde_json::to_string(&room.theme).unwrap_or_else(|_| "{}".into())),
                ),
                (
                    "defaultThroughput".into(),
                    Self::n(room.queue.default_throughput_per_minute),
                ),
                ("counterShards".into(), Self::n(room.queue.counter_shards)),
                (
                    "tokenTtlSeconds".into(),
                    Self::n(room.queue.token_ttl_seconds),
                ),
                (
                    "visitorTtlHours".into(),
                    Self::n(room.queue.visitor_record_ttl_hours),
                ),
            ])))
            .send()
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        Ok(room)
    }

    async fn get_room(&self, tenant_id: &str, room_id: &str) -> Result<Room, AdminError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.rooms_table)
            .key("tenantId", Self::s(tenant_id))
            .key("roomId", Self::s(room_id))
            .send()
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let item = out.item.ok_or(AdminError::NotFound)?;
        Self::room_from_item(&item)
    }

    async fn create_event(
        &self,
        tenant_id: &str,
        mut event: EventConfig,
    ) -> Result<EventConfig, AdminError> {
        if event.event_id.is_empty() {
            event.event_id = Uuid::new_v4().to_string();
        }
        let mut item = HashMap::from([
            ("tenantId".into(), Self::s(tenant_id)),
            ("eventId".into(), Self::s(&event.event_id)),
            ("roomId".into(), Self::s(&event.room_id)),
            (
                "throughputPerMinute".into(),
                Self::n(event.throughput_per_minute),
            ),
            ("paused".into(), AttributeValue::Bool(event.paused)),
            (
                "emergencyOpen".into(),
                AttributeValue::Bool(event.emergency_open),
            ),
            ("inviteOnly".into(), AttributeValue::Bool(event.invite_only)),
            (
                "botProtection".into(),
                Self::s(Self::bot_to(event.bot_protection)),
            ),
        ]);
        if let Some(url) = &event.return_url {
            item.insert("returnUrl".into(), Self::s(url));
        }
        self.client
            .put_item()
            .table_name(&self.events_table)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        Ok(event)
    }

    async fn list_events(&self, tenant_id: &str) -> Result<Vec<EventConfig>, AdminError> {
        let out = self
            .client
            .query()
            .table_name(&self.events_table)
            .key_condition_expression("tenantId = :t")
            .expression_attribute_values(":t", Self::s(tenant_id))
            .send()
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let mut events = Vec::new();
        for item in out.items.unwrap_or_default() {
            events.push(Self::event_from_item(&item)?);
        }
        Ok(events)
    }

    async fn update_event(
        &self,
        tenant_id: &str,
        event_id: &str,
        overrides: LiveOverrides,
    ) -> Result<EventConfig, AdminError> {
        let mut values = HashMap::new();
        let mut parts = Vec::new();

        if let Some(v) = overrides.paused {
            parts.push("paused = :p");
            values.insert(":p".into(), AttributeValue::Bool(v));
        }
        if let Some(v) = overrides.emergency_open {
            parts.push("emergencyOpen = :e");
            values.insert(":e".into(), AttributeValue::Bool(v));
        }
        if let Some(v) = overrides.throughput_per_minute {
            parts.push("throughputPerMinute = :t");
            values.insert(":t".into(), Self::n(v));
        }
        if let Some(v) = overrides.bot_protection {
            parts.push("botProtection = :b");
            values.insert(":b".into(), Self::s(Self::bot_to(v)));
        }
        if parts.is_empty() {
            return self
                .client
                .get_item()
                .table_name(&self.events_table)
                .key("tenantId", Self::s(tenant_id))
                .key("eventId", Self::s(event_id))
                .send()
                .await
                .map_err(|e| AdminError::Message(e.to_string()))?
                .item
                .ok_or(AdminError::NotFound)
                .and_then(|i| Self::event_from_item(&i));
        }

        let out = self
            .client
            .update_item()
            .table_name(&self.events_table)
            .key("tenantId", Self::s(tenant_id))
            .key("eventId", Self::s(event_id))
            .update_expression(format!("SET {}", parts.join(", ")))
            .set_expression_attribute_values(Some(values))
            .return_values(aws_sdk_dynamodb::types::ReturnValue::AllNew)
            .send()
            .await
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let item = out.attributes.ok_or(AdminError::NotFound)?;
        Self::event_from_item(&item)
    }
}
