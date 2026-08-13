package io.vazue.queue;

import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AdmitTokenTest {
  private static String signHs256(Map<String, Object> payload, String secret) throws Exception {
    String header =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
    String body =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                new com.fasterxml.jackson.databind.ObjectMapper()
                    .writeValueAsBytes(payload));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    String sig =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(mac.doFinal((header + "." + body).getBytes(StandardCharsets.UTF_8)));
    return header + "." + body + "." + sig;
  }

  @Test
  void acceptsValidAndRejectsBad() throws Exception {
    String secret = "origin-secret-16chars";
    Instant now = Instant.ofEpochSecond(1_700_000_000L);
    String good =
        signHs256(Map.of("sub", "req-1", "exp", now.getEpochSecond() + 60, "event_id", "demo"), secret);
    Optional<Map<String, Object>> claims = AdmitToken.verify(good, secret, now);
    assertTrue(claims.isPresent());
    assertEquals("demo", claims.get().get("event_id"));
    assertTrue(AdmitToken.verify(good, "wrong-secret!!!!!!", now).isEmpty());
    String expired = signHs256(Map.of("sub", "req-1", "exp", now.getEpochSecond() - 1), secret);
    assertTrue(AdmitToken.verify(expired, secret, now).isEmpty());
  }

  @Test
  void extractsFromCookieAndQuery() {
    assertEquals(
        Optional.of("abc"), AdmitToken.extract("a=1; vazue_token=abc; b=2", null));
    assertEquals(Optional.of("xyz"), AdmitToken.extract(null, "vazue_token=xyz"));
  }
}
