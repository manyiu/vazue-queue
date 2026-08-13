# io.vazue:queue-sdk

Hand-polished Java 11+ client for the Vazue Queue data plane.

```xml
<dependency>
  <groupId>io.vazue</groupId>
  <artifactId>queue-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

```java
QueueClient client = new QueueClient("https://queue.example.com");
QueueClient.EnrollRequest body = new QueueClient.EnrollRequest();
body.returnUrl = "https://shop.example.com/checkout";
QueueClient.EnrollResponse enrolled = client.enroll("demo", body);
QueueClient.StatusResponse status = client.status("demo", enrolled.requestId);
AdmitToken.verify(status.admitToken, hmacSecret, Instant.now());
```

## Test without a local JDK

```bash
bash scripts/sdk-java-test.sh   # Docker — local convenience
```

CI uses Temurin 11 + Maven via `actions/setup-java` (see `.github/workflows/generate-sdks.yml`).
