//! Secrets Manager / env resolution for Lambda cold start.

pub fn bot_protection_needs_turnstile() -> bool {
    let mode = std::env::var("BOT_PROTECTION_MODE").unwrap_or_else(|_| "off".into());
    mode == "challenge_always" || mode == "challenge_suspicious"
}

pub async fn load_signing_secret(conf: &aws_config::SdkConfig) -> Result<Vec<u8>, String> {
    load_secret_from_env_or_arn(conf, "SIGNING_SECRET", "SIGNING_SECRET_ARN", true)
        .await?
        .map(|s| s.into_bytes())
        .ok_or_else(|| "empty signing secret".into())
}

pub async fn load_optional_turnstile_secret(
    conf: &aws_config::SdkConfig,
) -> Result<Option<String>, String> {
    load_secret_from_env_or_arn(conf, "TURNSTILE_SECRET", "TURNSTILE_SECRET_ARN", false).await
}

async fn load_secret_from_env_or_arn(
    conf: &aws_config::SdkConfig,
    plain_env: &str,
    arn_env: &str,
    required: bool,
) -> Result<Option<String>, String> {
    if let Ok(raw) = std::env::var(plain_env) {
        return Ok(Some(raw));
    }
    let arn = match std::env::var(arn_env) {
        Ok(a) => a,
        Err(_) if required => {
            return Err(format!("{plain_env} or {arn_env} required"));
        }
        Err(_) => return Ok(None),
    };
    let sm = aws_sdk_secretsmanager::Client::new(conf);
    let out = sm
        .get_secret_value()
        .secret_id(arn)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    out.secret_string()
        .map(|s| s.to_string())
        .or_else(|| {
            out.secret_binary()
                .map(|b| String::from_utf8_lossy(b.as_ref()).into_owned())
        })
        .ok_or_else(|| format!("empty secret for {arn_env}"))
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_env::lock_env;

    struct EnvGuard {
        set: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn new() -> Self {
            Self { set: Vec::new() }
        }

        fn set(&mut self, key: &'static str, value: &str) {
            let prior = std::env::var(key).ok();
            std::env::set_var(key, value);
            self.set.push((key, prior));
        }

        fn remove(&mut self, key: &'static str) {
            let prior = std::env::var(key).ok();
            std::env::remove_var(key);
            self.set.push((key, prior));
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, prior) in self.set.drain(..) {
                match prior {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn bot_protection_modes() {
        let _lock = lock_env();
        let mut env = EnvGuard::new();
        env.set("BOT_PROTECTION_MODE", "off");
        assert!(!bot_protection_needs_turnstile());
        env.set("BOT_PROTECTION_MODE", "challenge_always");
        assert!(bot_protection_needs_turnstile());
        env.set("BOT_PROTECTION_MODE", "challenge_suspicious");
        assert!(bot_protection_needs_turnstile());
    }

    #[tokio::test]
    async fn turnstile_secret_from_plain_env() {
        let _lock = lock_env();
        let mut env = EnvGuard::new();
        env.set("TURNSTILE_SECRET", "test-turnstile-key");
        env.remove("TURNSTILE_SECRET_ARN");
        let conf = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
        let secret = load_optional_turnstile_secret(&conf)
            .await
            .expect("plain env turnstile secret");
        assert_eq!(secret.as_deref(), Some("test-turnstile-key"));
    }
}
