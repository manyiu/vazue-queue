#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    queue_api::lambda_runtime::run_enroll_worker().await
}
