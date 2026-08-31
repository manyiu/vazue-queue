# io.vazue:queue-sdk

Hand-polished Java 11+ client for the Vazue Queue data plane.

```xml
<dependency>
  <groupId>io.vazue</groupId>
  <artifactId>queue-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Client

```java
QueueClient client = new QueueClient("https://queue.example.com");
QueueClient.EnrollRequest body = new QueueClient.EnrollRequest();
body.returnUrl = "https://shop.example.com/checkout";
QueueClient.EnrollResponse enrolled = client.enroll("my-event", body);
QueueClient.StatusResponse status = client.status("my-event", enrolled.requestId);
```

Poll until `status.admitted` is true, then verify `status.admitToken`.

## Origin verification

```java
Optional<String> token = AdmitToken.extract(request.getHeader("Cookie"), request.getQueryString());
Optional<Map<String, Object>> claims =
    token.flatMap(t -> AdmitToken.verify(t, System.getenv("VAZUE_JWT_SECRET"), Instant.now()));
```

## Tests

```bash
mvn test                                            # unit tests
bash scripts/sdk-java-test.sh                       # Docker (no local JDK)
SDK_INTEGRATION=1 mvn test                          # against local-server
```

## Docs

[queue.vazue.com/docs/reference/sdks](https://queue.vazue.com/docs/reference/sdks)
