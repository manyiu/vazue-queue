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
    pub invite_only: Option<bool>,
    pub dress_rehearsal: Option<bool>,
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
pub trait AdminStore: Send + Sync {
    async fn create_room(&self, tenant_id: &str, room: Room) -> Result<Room, AdminError>;
    async fn get_room(&self, tenant_id: &str, room_id: &str) -> Result<Room, AdminError>;
    async fn list_rooms(&self, tenant_id: &str) -> Result<Vec<Room>, AdminError>;
    async fn update_room(
        &self,
        tenant_id: &str,
        room_id: &str,
        room: Room,
    ) -> Result<Room, AdminError>;
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
    async fn event_stats(&self, tenant_id: &str, event_id: &str) -> Result<EventStats, AdminError>;
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

    async fn list_rooms(&self, tenant_id: &str) -> Result<Vec<Room>, AdminError> {
        let g = self
            .rooms
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let prefix = format!("{tenant_id}|");
        Ok(g.iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(_, v)| v.clone())
            .collect())
    }

    async fn update_room(
        &self,
        tenant_id: &str,
        room_id: &str,
        mut room: Room,
    ) -> Result<Room, AdminError> {
        let mut g = self
            .rooms
            .lock()
            .map_err(|e| AdminError::Message(e.to_string()))?;
        let key = Self::key(tenant_id, room_id);
        if !g.contains_key(&key) {
            return Err(AdminError::NotFound);
        }
        room.room_id = room_id.to_string();
        g.insert(key, room.clone());
        Ok(room)
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
        if let Some(v) = overrides.invite_only {
            e.invite_only = v;
        }
        if let Some(v) = overrides.dress_rehearsal {
            e.dress_rehearsal = v;
        }
        Ok(e.clone())
    }

    async fn event_stats(&self, tenant_id: &str, event_id: &str) -> Result<EventStats, AdminError> {
        let e = self
            .list_events(tenant_id)
            .await?
            .into_iter()
            .find(|ev| ev.event_id == event_id)
            .ok_or(AdminError::NotFound)?;
        Ok(EventStats {
            event_id: e.event_id.clone(),
            serving: 0,
            queue_depth: 0,
            waiting: 0,
            admitted: 0,
            throughput_per_minute: e.throughput_per_minute,
            paused: e.paused,
            emergency_open: e.emergency_open,
            dress_rehearsal: e.dress_rehearsal,
        })
    }
}

impl EventStats {
    pub fn to_csv(&self) -> String {
        format!(
            "event_id,serving,queue_depth,waiting,admitted,throughput_per_minute,paused,emergency_open,dress_rehearsal\n{},{},{},{},{},{},{},{},{}\n",
            self.event_id,
            self.serving,
            self.queue_depth,
            self.waiting,
            self.admitted,
            self.throughput_per_minute,
            self.paused,
            self.emergency_open,
            self.dress_rehearsal
        )
    }
}
