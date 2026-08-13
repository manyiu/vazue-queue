use async_trait::async_trait;
use queue_kernel::{BotProtectionMode, EventConfig, QueueConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AdminError {
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub room_id: String,
    pub name: String,
    pub theme: serde_json::Value,
    pub queue: QueueConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveOverrides {
    pub paused: Option<bool>,
    pub emergency_open: Option<bool>,
    pub throughput_per_minute: Option<u32>,
    pub bot_protection: Option<BotProtectionMode>,
}

#[async_trait]
pub trait AdminStore: Send + Sync {
    async fn create_room(&self, tenant_id: &str, room: Room) -> Result<Room, AdminError>;
    async fn get_room(&self, tenant_id: &str, room_id: &str) -> Result<Room, AdminError>;
    async fn create_event(
        &self,
        tenant_id: &str,
        event: EventConfig,
    ) -> Result<EventConfig, AdminError>;
    async fn list_events(&self, tenant_id: &str) -> Result<Vec<EventConfig>, AdminError>;
    async fn update_event(
        &self,
        tenant_id: &str,
        event_id: &str,
        overrides: LiveOverrides,
    ) -> Result<EventConfig, AdminError>;
}

#[derive(Default)]
pub struct InMemoryAdminStore {
    rooms: Mutex<HashMap<String, Room>>,
    events: Mutex<HashMap<String, EventConfig>>,
}

impl InMemoryAdminStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn key(tenant: &str, id: &str) -> String {
        format!("{tenant}|{id}")
    }
}

#[async_trait]
impl AdminStore for InMemoryAdminStore {
    async fn create_room(&self, tenant_id: &str, mut room: Room) -> Result<Room, AdminError> {
        if room.room_id.is_empty() {
            room.room_id = Uuid::new_v4().to_string();
        }
        let mut g = self
            .rooms
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        g.insert(Self::key(tenant_id, &room.room_id), room.clone());
        Ok(room)
    }

    async fn get_room(&self, tenant_id: &str, room_id: &str) -> Result<Room, AdminError> {
        let g = self
            .rooms
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        g.get(&Self::key(tenant_id, room_id))
            .cloned()
            .ok_or(AdminError::NotFound)
    }

    async fn create_event(
        &self,
        tenant_id: &str,
        mut event: EventConfig,
    ) -> Result<EventConfig, AdminError> {
        if event.event_id.is_empty() {
            event.event_id = Uuid::new_v4().to_string();
        }
        let mut g = self
            .events
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        g.insert(Self::key(tenant_id, &event.event_id), event.clone());
        Ok(event)
    }

    async fn list_events(&self, tenant_id: &str) -> Result<Vec<EventConfig>, AdminError> {
        let g = self
            .events
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let prefix = format!("{tenant_id}|");
        Ok(g.iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(_, v)| v.clone())
            .collect())
    }

    async fn update_event(
        &self,
        tenant_id: &str,
        event_id: &str,
        overrides: LiveOverrides,
    ) -> Result<EventConfig, AdminError> {
        let mut g = self
            .events
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let e = g
            .get_mut(&Self::key(tenant_id, event_id))
            .ok_or(AdminError::NotFound)?;
        if let Some(v) = overrides.paused {
            e.paused = v;
        }
        if let Some(v) = overrides.emergency_open {
            e.emergency_open = v;
        }
        if let Some(v) = overrides.throughput_per_minute {
            e.throughput_per_minute = v;
        }
        if let Some(v) = overrides.bot_protection {
            e.bot_protection = v;
        }
        Ok(e.clone())
    }
}
