//! Platform adapters: deployment profile, capabilities, metering stubs.

pub mod turnstile;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentProfile {
    #[default]
    Oss,
    Saas,
}

impl DeploymentProfile {
    pub fn from_env() -> Self {
        match std::env::var("VAZUE_DEPLOYMENT_PROFILE")
            .unwrap_or_else(|_| "oss".into())
            .to_lowercase()
            .as_str()
        {
            "saas" => Self::Saas,
            _ => Self::Oss,
        }
    }

    pub fn emit_usage_events(&self) -> bool {
        matches!(self, Self::Saas)
    }

    pub fn enforce_plan_limits(&self) -> bool {
        matches!(self, Self::Saas)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub deployment: DeploymentProfile,
    pub limits: PlanLimits,
    pub features: FeatureFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanLimits {
    pub max_counter_shards: u32,
    pub max_throughput_per_minute: u32,
    pub max_concurrent_visitors: u64,
}

impl Default for PlanLimits {
    fn default() -> Self {
        Self {
            max_counter_shards: 64,
            max_throughput_per_minute: 10_000,
            max_concurrent_visitors: 1_000_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlags {
    pub valkey: bool,
    pub edge_connector: bool,
    pub bot_protection: bool,
    pub analytics: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            valkey: true,
            edge_connector: true,
            bot_protection: true,
            analytics: true,
        }
    }
}

impl Capabilities {
    pub fn oss_full() -> Self {
        Self {
            deployment: DeploymentProfile::Oss,
            limits: PlanLimits::default(),
            features: FeatureFlags::default(),
        }
    }

    pub fn saas_free() -> Self {
        Self {
            deployment: DeploymentProfile::Saas,
            limits: PlanLimits {
                max_counter_shards: 8,
                max_throughput_per_minute: 200,
                max_concurrent_visitors: 10_000,
            },
            features: FeatureFlags {
                valkey: false,
                edge_connector: true,
                bot_protection: true,
                analytics: true,
            },
        }
    }
}

/// Resolve tenant id from hostname like `{tenant}.wait.queue.vazue.com`.
pub fn tenant_from_host(host: &str) -> Option<String> {
    let host = host.split(':').next().unwrap_or(host).to_lowercase();
    let parts: Vec<&str> = host.split('.').collect();
    // {tenant}.wait.queue.vazue.com
    if parts.len() >= 5 && parts[1] == "wait" {
        return Some(parts[0].to_string());
    }
    // OSS single domain — default tenant
    Some("default".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_saas_host() {
        assert_eq!(
            tenant_from_host("acme.wait.queue.vazue.com"),
            Some("acme".into())
        );
    }
}
