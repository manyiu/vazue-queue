use std::sync::Arc;

use aws_sdk_sqs::Client as SqsClient;
use platform::{Capabilities, DeploymentProfile};
use queue_kernel::JwtKeys;

use crate::store::QueueStore;

#[derive(Clone)]
pub struct AppState {
    /// Absent on buffered EnrollFn (SQS accept path only).
    pub store: Option<Arc<dyn QueueStore>>,
    /// Absent on buffered EnrollFn.
    pub keys: Option<Arc<JwtKeys>>,
    pub use_rsa: bool,
    pub tenant_id: String,
    pub profile: DeploymentProfile,
    pub capabilities: Capabilities,
    pub enroll_via_sqs: bool,
    /// Reused across buffered enroll requests (cold start only).
    pub enroll_sqs: Option<SqsClient>,
    pub enroll_queue_url: Option<String>,
}

impl AppState {
    pub fn local(store: Arc<dyn QueueStore>, secret: &[u8]) -> Self {
        Self {
            store: Some(store),
            keys: Some(Arc::new(JwtKeys::from_hmac_secret(secret))),
            use_rsa: false,
            tenant_id: "default".into(),
            profile: DeploymentProfile::Oss,
            capabilities: Capabilities::oss_full(),
            enroll_via_sqs: false,
            enroll_sqs: None,
            enroll_queue_url: None,
        }
    }

    pub fn require_store(&self) -> &Arc<dyn QueueStore> {
        self.store
            .as_ref()
            .expect("queue store not configured on this Lambda")
    }

    pub fn require_keys(&self) -> &Arc<JwtKeys> {
        self.keys
            .as_ref()
            .expect("signing keys not configured on this Lambda")
    }
}
