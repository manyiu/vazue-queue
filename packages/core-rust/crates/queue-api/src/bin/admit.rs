#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    queue_api::lambda_runtime::run_admit().await
}
