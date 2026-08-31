//! Platform adapters: deployment capabilities and Turnstile verification.

pub mod turnstile;

pub use turnstile::verify_turnstile;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Capabilities {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_capabilities_expose_full_oss_limits() {
        let caps = Capabilities::default();
        assert_eq!(caps.limits.max_counter_shards, 64);
        assert_eq!(caps.limits.max_throughput_per_minute, 10_000);
        assert_eq!(caps.limits.max_concurrent_visitors, 1_000_000);
        assert!(caps.features.edge_connector);
    }

    #[test]
    fn capabilities_json_has_no_deployment_profile() {
        let value = serde_json::to_value(Capabilities::default()).unwrap();
        assert!(value.get("limits").is_some());
        assert!(value.get("features").is_some());
        assert!(value.get("deployment").is_none());
    }
}
