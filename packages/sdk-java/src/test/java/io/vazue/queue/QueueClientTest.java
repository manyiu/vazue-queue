package io.vazue.queue;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;

class QueueClientTest {
  @Test
  void enrollRequestOmitsInviteCode() throws Exception {
    QueueClient.EnrollRequest req = new QueueClient.EnrollRequest();
    req.sessionId = "s1";
    req.returnUrl = "https://example.com";
    req.turnstileToken = "tok";
    String json = new ObjectMapper().writeValueAsString(req);
    assertFalse(json.contains("invite_code"), json);
  }
}
