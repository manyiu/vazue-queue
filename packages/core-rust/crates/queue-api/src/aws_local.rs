//! DynamoDB Local defaults for `local-server` when `VAZUE_USE_DYNAMODB=1`.

/// Apply fake credentials, endpoint, and table names when unset so `aws_config::load_defaults`
/// and `DynamoDbStore::from_env` work against DynamoDB Local (`docker-compose.local.yml`).
pub fn apply_dynamodb_local_env_defaults() {
    set_if_absent("AWS_ACCESS_KEY_ID", "local");
    set_if_absent("AWS_SECRET_ACCESS_KEY", "local");
    set_if_absent("AWS_REGION", "us-east-1");
    set_if_absent("AWS_DEFAULT_REGION", "us-east-1");
    set_if_absent("AWS_ENDPOINT_URL_DYNAMODB", "http://127.0.0.1:8000");
    set_if_absent("EVENTS_TABLE", "Events");
    set_if_absent("VISITORS_TABLE", "Visitors");
    set_if_absent("COUNTERS_TABLE", "Counters");
    set_if_absent("ROOMS_TABLE", "Rooms");
    set_if_absent("COUNTER_SHARDS", "8");
    set_if_absent("TOKEN_TTL_SECONDS", "3600");
    set_if_absent("VISITOR_TTL_HOURS", "24");
}

fn set_if_absent(key: &str, val: &str) {
    if std::env::var(key).is_err() {
        std::env::set_var(key, val);
    }
}
