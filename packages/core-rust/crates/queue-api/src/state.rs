use std::sync::Arc;

use platform::{Capabilities, DeploymentProfile};
use queue_kernel::JwtKeys;

use crate::store::QueueStore;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<dyn QueueStore>,
    pub keys: Arc<JwtKeys>,
    pub use_rsa: bool,
    pub tenant_id: String,
    pub profile: DeploymentProfile,
    pub capabilities: Capabilities,
    pub enroll_via_sqs: bool,
}

impl AppState {
    pub fn local(store: Arc<dyn QueueStore>, secret: &[u8]) -> Self {
        Self {
            store,
            keys: Arc::new(JwtKeys::from_hmac_secret(secret)),
            use_rsa: false,
            tenant_id: "default".into(),
            profile: DeploymentProfile::Oss,
            capabilities: Capabilities::oss_full(),
            enroll_via_sqs: false,
        }
    }
}
