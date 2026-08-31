package io.vazue.queue;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@EnabledIfEnvironmentVariable(named = "SDK_INTEGRATION", matches = "1")
class LocalIntegrationTest {
  private static final String LOCAL_SECRET = "local-dev-hmac-secret-change-me";
  private static final String EVENT = "demo";

  private static String apiBase() {
    String v = System.getenv("QUEUE_API_URL");
    return v != null && !v.isBlank() ? v : "http://127.0.0.1:3000";
  }

  private static String adminBase() {
    String v = System.getenv("ADMIN_API_URL");
    return v != null && !v.isBlank() ? v : "http://127.0.0.1:3001";
  }

  @BeforeAll
  static void openQueue() throws Exception {
    setEmergencyOpen(true);
  }

  @AfterAll
  static void closeQueue() throws Exception {
    setEmergencyOpen(false);
  }

  private static void setEmergencyOpen(boolean open) throws Exception {
    HttpClient http = HttpClient.newHttpClient();
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(adminBase() + "/v1/events/" + EVENT))
            .header("content-type", "application/json")
            .PUT(HttpRequest.BodyPublishers.ofString("{\"emergency_open\":" + open + "}"))
            .build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() < 200 || res.statusCode() >= 300) {
      throw new IllegalStateException("admin update failed: " + res.statusCode());
    }
  }

  @Test
  void enrollAdmitVerify() throws Exception {
    QueueClient client = new QueueClient(apiBase());
    QueueClient.EnrollRequest body = new QueueClient.EnrollRequest();
    body.returnUrl = "https://example.com/checkout";

    QueueClient.EnrollResponse enrolled = client.enroll(EVENT, body);
    assertNotNull(enrolled.requestId);

    QueueClient.StatusResponse status = client.status(EVENT, enrolled.requestId);
    assertTrue(status.admitted);
    assertNotNull(status.admitToken);

    Optional<Map<String, Object>> claims =
        AdmitToken.verify(status.admitToken, LOCAL_SECRET, Instant.now());
    assertTrue(claims.isPresent());
  }
}
