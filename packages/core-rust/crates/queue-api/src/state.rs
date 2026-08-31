use std::sync::Arc;

use aws_sdk_sqs::Client as SqsClient;
use platform::Capabilities;
use queue_kernel::JwtKeys;

use crate::secrets::bot_protection_needs_turnstile;
use crate::store::{EnrollRequest, QueueStore};

#[derive(Clone)]
pub struct AppState {
    /// Absent on buffered EnrollFn (SQS accept path only).
    pub store: Option<Arc<dyn QueueStore>>,
    /// Absent on buffered EnrollFn.
    pub keys: Option<Arc<JwtKeys>>,
    pub use_rsa: bool,
    pub tenant_id: String,
    pub capabilities: Capabilities,
    pub enroll_via_sqs: bool,
    /// Reused across buffered enroll requests (cold start only).
    pub enroll_sqs: Option<SqsClient>,
    pub enroll_queue_url: Option<String>,
    /// Loaded at cold start from `TURNSTILE_SECRET` or `TURNSTILE_SECRET_ARN`.
    pub turnstile_secret: Option<String>,
}

impl AppState {
    pub fn local(store: Arc<dyn QueueStore>, secret: &[u8]) -> Self {
        Self {
            store: Some(store),
            keys: Some(Arc::new(JwtKeys::from_hmac_secret(secret))),
            use_rsa: false,
            tenant_id: "default".into(),
            capabilities: Capabilities::default(),
            enroll_via_sqs: false,
            enroll_sqs: None,
            enroll_queue_url: None,
            turnstile_secret: std::env::var("TURNSTILE_SECRET").ok(),
        }
    }

    pub async fn verify_enroll_turnstile(&self, body: &EnrollRequest) -> Result<(), String> {
        if !bot_protection_needs_turnstile() {
            return Ok(());
        }
        let token = body.turnstile_token.as_deref().unwrap_or("");
        let local = std::env::var("VAZUE_LOCAL").ok().as_deref() == Some("1");
        let secret = self
            .turnstile_secret
            .clone()
            .or_else(|| std::env::var("TURNSTILE_SECRET").ok())
            .filter(|s| !s.is_empty());
        let secret = match secret {
            Some(s) => s,
            None if local => "bypass".into(),
            None => {
                return Err(
                    "TURNSTILE_SECRET or TURNSTILE_SECRET_ARN required when bot protection uses challenges"
                        .into(),
                );
            }
        };
        let ok = platform::verify_turnstile(&secret, token, None, local).await?;
        if !ok {
            return Err("captcha failed".into());
        }
        Ok(())
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
