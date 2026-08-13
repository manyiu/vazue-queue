//! Optional Turnstile verification (botProtection modes).

/// Verify Cloudflare Turnstile token. In local mode, non-empty token or bypass secret passes.
pub async fn verify_turnstile(
    secret: &str,
    token: &str,
    remote_ip: Option<&str>,
    local_mode: bool,
) -> Result<bool, String> {
    if local_mode {
        return Ok(!token.is_empty() || secret == "bypass");
    }
    if token.is_empty() {
        return Ok(false);
    }
    let client = reqwest::Client::new();
    let mut form = vec![
        ("secret", secret.to_string()),
        ("response", token.to_string()),
    ];
    if let Some(ip) = remote_ip {
        form.push(("remoteip", ip.to_string()));
    }
    let res = client
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(body
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_bypass() {
        assert!(verify_turnstile("bypass", "", None, true).await.unwrap());
        assert!(verify_turnstile("x", "token", None, true).await.unwrap());
    }
}
