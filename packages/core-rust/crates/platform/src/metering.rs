//! Usage metering emit hooks (no-op for OSS; EventBridge-shaped for SaaS).

use crate::DeploymentProfile;
use serde::Serialize;
use tracing::info;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MeterName {
    VisitorsEnrolled,
    TokensIssued,
    ApiRequests,
    ActiveEvents,
    ConnectorRequests,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageEvent {
    pub meter: MeterName,
    pub tenant_id: String,
    pub event_id: Option<String>,
    pub quantity: u64,
    pub detail_type: String,
}

impl UsageEvent {
    pub fn enrolled(tenant_id: impl Into<String>, event_id: impl Into<String>) -> Self {
        Self {
            meter: MeterName::VisitorsEnrolled,
            tenant_id: tenant_id.into(),
            event_id: Some(event_id.into()),
            quantity: 1,
            detail_type: "visitor.enrolled".into(),
        }
    }

    pub fn token_issued(tenant_id: impl Into<String>, event_id: impl Into<String>) -> Self {
        Self {
            meter: MeterName::TokensIssued,
            tenant_id: tenant_id.into(),
            event_id: Some(event_id.into()),
            quantity: 1,
            detail_type: "token.issued".into(),
        }
    }
}

/// Emit a usage event when the deployment profile enables metering.
/// OSS: structured log only. SaaS: same log (EventBridge put wired by SaaS Lambda later).
pub fn emit_usage(profile: DeploymentProfile, event: &UsageEvent) {
    if !profile.emit_usage_events() {
        return;
    }
    info!(
        target: "vazue.metering",
        meter = ?event.meter,
        tenant_id = %event.tenant_id,
        event_id = ?event.event_id,
        quantity = event.quantity,
        detail_type = %event.detail_type,
        "usage event"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oss_is_noop() {
        let ev = UsageEvent::enrolled("t", "e");
        emit_usage(DeploymentProfile::Oss, &ev);
    }

    #[test]
    fn saas_logs() {
        let ev = UsageEvent::token_issued("t", "e");
        emit_usage(DeploymentProfile::Saas, &ev);
    }
}
