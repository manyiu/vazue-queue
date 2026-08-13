//! Shared Lambda bootstrap for enroll / status / admit / reaper.

use std::sync::Arc;

use aws_config::BehaviorVersion;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use queue_kernel::JwtKeys;
use serde_json::json;
use tracing_subscriber::EnvFilter;

use crate::dynamodb_store::DynamoDbStore;
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
    let tenant_id = std::env::var("TENANT_ID").unwrap_or_else(|_| "default".into());
    Ok(AppState {
        store: Arc::new(store),
        keys: Arc::new(JwtKeys::from_hmac_secret(&secret)),
        use_rsa: false,
        tenant_id,
        profile: platform::DeploymentProfile::Oss,
        capabilities: platform::Capabilities::oss_full(),
        enroll_via_sqs: std::env::var("ENROLL_VIA_SQS").ok().as_deref() == Some("1"),
    })
}

async fn load_signing_secret(conf: &aws_config::SdkConfig) -> Result<Vec<u8>, String> {
    if let Ok(raw) = std::env::var("SIGNING_SECRET") {
        return Ok(raw.into_bytes());
    }
    let arn = std::env::var("SIGNING_SECRET_ARN")
        .map_err(|_| "SIGNING_SECRET or SIGNING_SECRET_ARN required".to_string())?;
    let sm = aws_sdk_secretsmanager::Client::new(conf);
    let out = sm
        .get_secret_value()
        .secret_id(arn)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    out.secret_string()
        .map(|s| s.as_bytes().to_vec())
        .or_else(|| out.secret_binary().map(|b| b.clone().into_inner()))
        .ok_or_else(|| "empty signing secret".into())
}

fn json_response(status: u16, body: impl serde::Serialize) -> Result<Response<Body>, Error> {
    let body = serde_json::to_vec(&body)?;
    Ok(Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))?)
}

pub async fn run_enroll() -> Result<(), Error> {
    init_tracing();
    let state = Arc::new(build_aws_state().await.map_err(Error::from)?);
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
            session_id: None,
            return_url: None,
            invite_code: None,
            turnstile_token: None,
        });
    body.event_id = event_id;
    match state
        .store
        .enroll(&state.tenant_id, body, &state.keys, state.use_rsa)
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
        .store
        .status(
            &state.tenant_id,
            &event_id,
            &request_id,
            &state.keys,
            state.use_rsa,
        )
        .await
    {
        Ok(resp) => json_response(200, resp),
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
        .store
        .admit(
            &state.tenant_id,
            &event_id,
            &body.request_id,
            &state.keys,
            state.use_rsa,
        )
        .await
    {
        Ok(resp) => json_response(200, resp),
        Err(e) => json_response(map_status(&e), json!({ "error": e.to_string() })),
    }
}

pub async fn run_reaper() -> Result<(), Error> {
    init_tracing();
    let state = build_aws_state().await.map_err(Error::from)?;
    let event_id = std::env::var("EVENT_ID").unwrap_or_default();
    if event_id.is_empty() {
        tracing::warn!("EVENT_ID not set; reaper no-op");
        return Ok(());
    }
    let advanced = state
        .store
        .reaper_tick(&state.tenant_id, &event_id)
        .await
        .map_err(|e| Error::from(e.to_string()))?;
    tracing::info!(advanced, "serving reaper tick");
    Ok(())
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
