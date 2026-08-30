//! Shared Lambda bootstrap for enroll / status / admit / reaper / enroll-worker.

use std::sync::Arc;

use aws_config::BehaviorVersion;
use aws_lambda_events::event::sqs::SqsEvent;
use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use queue_kernel::JwtKeys;
use serde_json::json;
use tracing_subscriber::EnvFilter;

use crate::dynamodb_store::DynamoDbStore;
use crate::secrets::{
    bot_protection_needs_turnstile, load_optional_turnstile_secret, load_signing_secret,
};
use crate::state::AppState;
use crate::store::EnrollRequest;

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .try_init();
}

pub async fn build_aws_state() -> Result<AppState, String> {
    let conf = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let ddb = aws_sdk_dynamodb::Client::new(&conf);
    let store = DynamoDbStore::from_env(ddb).map_err(|e| e.to_string())?;
    let secret = load_signing_secret(&conf).await?;
    let turnstile_secret = load_optional_turnstile_secret(&conf).await?;
    if bot_protection_needs_turnstile() && turnstile_secret.is_none() {
        return Err(
            "TURNSTILE_SECRET or TURNSTILE_SECRET_ARN required when bot protection uses challenges"
                .into(),
        );
    }
    let tenant_id = std::env::var("TENANT_ID").unwrap_or_else(|_| "default".into());
    let profile = platform::DeploymentProfile::from_env();
    let capabilities = deployment_capabilities(profile);
    let enroll_via_sqs = std::env::var("ENROLL_VIA_SQS").ok().as_deref() == Some("1");
    let enroll_queue_url = std::env::var("ENROLL_QUEUE_URL").ok();
    let enroll_sqs = if enroll_via_sqs && enroll_queue_url.is_some() {
        Some(aws_sdk_sqs::Client::new(&conf))
    } else {
        None
    };
    Ok(AppState {
        store: Some(Arc::new(store)),
        keys: Some(Arc::new(JwtKeys::from_hmac_secret(&secret))),
        use_rsa: false,
        tenant_id,
        profile,
        capabilities,
        enroll_via_sqs,
        enroll_sqs,
        enroll_queue_url,
        turnstile_secret,
    })
}

/// Buffered EnrollFn: SQS accept only — skip DynamoDB + signing secret at cold start.
pub async fn build_enroll_state() -> Result<AppState, String> {
    let enroll_via_sqs = std::env::var("ENROLL_VIA_SQS").ok().as_deref() == Some("1");
    if !enroll_via_sqs {
        return build_aws_state().await;
    }
    let enroll_queue_url = std::env::var("ENROLL_QUEUE_URL")
        .map_err(|_| "ENROLL_QUEUE_URL required when ENROLL_VIA_SQS=1".to_string())?;
    let conf = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let turnstile_secret = load_optional_turnstile_secret(&conf).await?;
    if bot_protection_needs_turnstile() && turnstile_secret.is_none() {
        return Err(
            "TURNSTILE_SECRET or TURNSTILE_SECRET_ARN required when bot protection uses challenges"
                .into(),
        );
    }
    let tenant_id = std::env::var("TENANT_ID").unwrap_or_else(|_| "default".into());
    let profile = platform::DeploymentProfile::from_env();
    Ok(AppState {
        store: None,
        keys: None,
        use_rsa: false,
        tenant_id,
        profile,
        capabilities: deployment_capabilities(profile),
        enroll_via_sqs: true,
        enroll_sqs: Some(aws_sdk_sqs::Client::new(&conf)),
        enroll_queue_url: Some(enroll_queue_url),
        turnstile_secret,
    })
}

fn deployment_capabilities(profile: platform::DeploymentProfile) -> platform::Capabilities {
    match profile {
        platform::DeploymentProfile::Saas => platform::Capabilities::saas_free(),
        platform::DeploymentProfile::Oss => platform::Capabilities::oss_full(),
    }
}

fn json_response(status: u16, body: impl serde::Serialize) -> Result<Response<Body>, Error> {
    json_response_headers(status, body, &[("cache-control", "no-store")])
}

fn json_response_headers(
    status: u16,
    body: impl serde::Serialize,
    extra: &[(&str, &str)],
) -> Result<Response<Body>, Error> {
    let body = serde_json::to_vec(&body)?;
    let mut builder = Response::builder()
        .status(status)
        .header("content-type", "application/json");
    for (k, v) in extra {
        builder = builder.header(*k, *v);
    }
    Ok(builder.body(Body::from(body))?)
}

pub async fn run_enroll() -> Result<(), Error> {
    init_tracing();
    let state = Arc::new(build_enroll_state().await.map_err(Error::from)?);
    run(service_fn(move |req: Request| {
        let state = state.clone();
        async move { handle_enroll(state, req).await }
    }))
    .await
}

async fn handle_enroll(state: Arc<AppState>, req: Request) -> Result<Response<Body>, Error> {
    let event_id = path_param(&req, "eventId").or_else(|| path_param(&req, "event_id"));
    let Some(event_id) = event_id else {
        return json_response(400, json!({ "error": "eventId required" }));
    };
    let mut body: EnrollRequest =
        serde_json::from_slice(req.body().as_ref()).unwrap_or(EnrollRequest {
            event_id: event_id.clone(),
            request_id: None,
            session_id: None,
            return_url: None,
            invite_code: None,
            turnstile_token: None,
        });
    body.event_id = event_id.clone();

    if let Err(e) = state.verify_enroll_turnstile(&body).await {
        return json_response(409, json!({ "error": e }));
    }

    if let (Some(sqs), Some(queue_url)) = (&state.enroll_sqs, &state.enroll_queue_url) {
        // Pre-assign ids so clients can poll status immediately (404 until worker finishes).
        let session_id = body
            .session_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let request_id = body
            .request_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        body.session_id = Some(session_id.clone());
        body.request_id = Some(request_id.clone());

        let payload = serde_json::to_string(&body).unwrap_or_default();
        sqs.send_message()
            .queue_url(queue_url)
            .message_body(payload)
            .send()
            .await
            .map_err(|e| Error::from(e.to_string()))?;
        return json_response(
            202,
            json!({
                "request_id": request_id,
                "session_id": session_id,
                "position": 0,
                "status": "enrolled",
            }),
        );
    }

    let store = match state.store.as_ref() {
        Some(s) => s,
        None => {
            return json_response(
                503,
                json!({ "error": "sync enroll unavailable on buffered EnrollFn" }),
            );
        }
    };
    let keys = state.require_keys();
    match store
        .enroll(&state.tenant_id, body, keys, state.use_rsa)
        .await
    {
        Ok(resp) => json_response(201, resp),
        Err(e) => json_response(map_status(&e), json!({ "error": e.to_string() })),
    }
}

pub async fn run_status() -> Result<(), Error> {
    init_tracing();
    let state = Arc::new(build_aws_state().await.map_err(Error::from)?);
    run(service_fn(move |req: Request| {
        let state = state.clone();
        async move { handle_status(state, req).await }
    }))
    .await
}

async fn handle_status(state: Arc<AppState>, req: Request) -> Result<Response<Body>, Error> {
    let path = req.uri().path();
    if path == "/health" || path.ends_with("/health") {
        return json_response(200, json!({ "status": "ok", "service": "vazue-queue" }));
    }
    if path == "/ready" || path.ends_with("/ready") {
        return json_response(
            200,
            json!({
                "status": "ready",
                "deployment": state.profile,
                "tenantId": state.tenant_id,
            }),
        );
    }

    let event_id = path_param(&req, "eventId")
        .or_else(|| path_param(&req, "event_id"))
        .unwrap_or_default();
    let request_id = req
        .query_string_parameters_ref()
        .and_then(|q| q.first("request_id").map(|s| s.to_string()))
        .unwrap_or_default();
    if event_id.is_empty() || request_id.is_empty() {
        return json_response(400, json!({ "error": "eventId and request_id required" }));
    }
    match state
        .require_store()
        .status(
            &state.tenant_id,
            &event_id,
            &request_id,
            state.require_keys(),
            state.use_rsa,
        )
        .await
    {
        Ok(resp) => {
            let max_age = resp.poll_after_seconds.clamp(1, 30);
            let cache = format!("public, max-age={max_age}, stale-while-revalidate=1");
            json_response_headers(200, resp, &[("cache-control", cache.as_str())])
        }
        Err(e) => json_response(map_status(&e), json!({ "error": e.to_string() })),
    }
}

pub async fn run_admit() -> Result<(), Error> {
    init_tracing();
    let state = Arc::new(build_aws_state().await.map_err(Error::from)?);
    run(service_fn(move |req: Request| {
        let state = state.clone();
        async move { handle_admit(state, req).await }
    }))
    .await
}

async fn handle_admit(state: Arc<AppState>, req: Request) -> Result<Response<Body>, Error> {
    let event_id = path_param(&req, "eventId")
        .or_else(|| path_param(&req, "event_id"))
        .unwrap_or_default();
    #[derive(serde::Deserialize)]
    struct BodyIn {
        request_id: String,
    }
    let body: BodyIn = serde_json::from_slice(req.body().as_ref()).unwrap_or(BodyIn {
        request_id: String::new(),
    });
    if event_id.is_empty() || body.request_id.is_empty() {
        return json_response(400, json!({ "error": "eventId and request_id required" }));
    }
    match state
        .require_store()
        .admit(
            &state.tenant_id,
            &event_id,
            &body.request_id,
            state.require_keys(),
            state.use_rsa,
        )
        .await
    {
        Ok(resp) => json_response(200, resp),
        Err(e) => json_response(map_status(&e), json!({ "error": e.to_string() })),
    }
}

pub async fn run_reaper() -> Result<(), lambda_runtime::Error> {
    init_tracing();
    let state = build_aws_state()
        .await
        .map_err(lambda_runtime::Error::from)?;
    let conf = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let ddb = aws_sdk_dynamodb::Client::new(&conf);
    let events_table = std::env::var("EVENTS_TABLE").unwrap_or_else(|_| "Events".into());
    let tenant_id = state.tenant_id.clone();

    let scanned = ddb
        .scan()
        .table_name(&events_table)
        .filter_expression("tenantId = :t")
        .expression_attribute_values(":t", AttributeValue::S(tenant_id.clone()))
        .send()
        .await
        .map_err(|e| lambda_runtime::Error::from(e.to_string()))?;

    let mut total = 0u64;
    for item in scanned.items.unwrap_or_default() {
        let Some(event_id) = item.get("eventId").and_then(|v| v.as_s().ok()) else {
            continue;
        };
        match state
            .require_store()
            .reaper_tick(&tenant_id, event_id)
            .await
        {
            Ok(n) => total += n,
            Err(e) => tracing::warn!(%event_id, error = %e, "reaper tick failed"),
        }
    }
    tracing::info!(advanced = total, "serving reaper complete");
    Ok(())
}

pub async fn run_enroll_worker() -> Result<(), lambda_runtime::Error> {
    init_tracing();
    let state = Arc::new(
        build_aws_state()
            .await
            .map_err(lambda_runtime::Error::from)?,
    );
    lambda_runtime::run(lambda_runtime::service_fn(
        move |event: lambda_runtime::LambdaEvent<SqsEvent>| {
            let state = state.clone();
            async move {
                for record in event.payload.records {
                    let body = record.body.unwrap_or_default();
                    let req: EnrollRequest = serde_json::from_str(&body).map_err(|e| {
                        lambda_runtime::Error::from(format!("bad enroll message: {e}"))
                    })?;
                    state
                        .require_store()
                        .enroll(&state.tenant_id, req, state.require_keys(), state.use_rsa)
                        .await
                        .map_err(|e| lambda_runtime::Error::from(e.to_string()))?;
                }
                Ok::<(), lambda_runtime::Error>(())
            }
        },
    ))
    .await
}

fn path_param(req: &Request, name: &str) -> Option<String> {
    req.path_parameters_ref()
        .and_then(|p| p.first(name).map(|s| s.to_string()))
}

fn map_status(e: &crate::store::StoreError) -> u16 {
    use crate::store::StoreError;
    match e {
        StoreError::NotFound => 404,
        StoreError::Conflict(_) => 409,
        StoreError::Message(_) => 400,
    }
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

    #[tokio::test]
    async fn build_enroll_state_buffered_paths() {
        let _lock = lock_env();
        let mut env = EnvGuard::new();
        env.set("AWS_REGION", "us-east-1");
        env.set("AWS_ACCESS_KEY_ID", "test");
        env.set("AWS_SECRET_ACCESS_KEY", "test");
        env.set("BOT_PROTECTION_MODE", "off");
        env.set("ENROLL_VIA_SQS", "1");
        env.set(
            "ENROLL_QUEUE_URL",
            "https://sqs.us-east-1.amazonaws.com/123456789012/enroll-buffer",
        );
        let state = build_enroll_state().await.expect("buffered enroll state");
        assert!(state.enroll_via_sqs);
        assert!(state.store.is_none());
        assert!(state.keys.is_none());
        assert!(state.enroll_sqs.is_some());
        assert_eq!(
            state.enroll_queue_url.as_deref(),
            Some("https://sqs.us-east-1.amazonaws.com/123456789012/enroll-buffer")
        );

        env.remove("ENROLL_QUEUE_URL");
        let err = match build_enroll_state().await {
            Err(e) => e,
            Ok(_) => panic!("expected missing ENROLL_QUEUE_URL to fail"),
        };
        assert!(err.contains("ENROLL_QUEUE_URL"));
    }
}
