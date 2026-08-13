package io.vazue.queue;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Objects;

/** HTTP client for the Vazue Queue data plane. */
public final class QueueClient {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final String baseUrl;
  private final HttpClient http;

  public QueueClient(String baseUrl) {
    this(baseUrl, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());
  }

  public QueueClient(String baseUrl, HttpClient http) {
    this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl").replaceAll("/$", "");
    this.http = Objects.requireNonNull(http, "http");
  }

  public EnrollResponse enroll(String eventId, EnrollRequest body) throws IOException, InterruptedException {
    if (body == null) {
      body = new EnrollRequest();
    }
    HttpRequest req =
        HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/v1/events/" + enc(eventId) + "/enroll"))
            .timeout(Duration.ofSeconds(30))
            .header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
            .build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    // 201 sync · 202 async enroll buffer
    if (res.statusCode() != 201 && res.statusCode() != 202) {
      throw new IOException("enroll failed: " + res.statusCode() + " " + res.body());
    }
    return MAPPER.readValue(res.body(), EnrollResponse.class);
  }

  public StatusResponse status(String eventId, String requestId) throws IOException, InterruptedException {
    URI uri =
        URI.create(
            baseUrl
                + "/v1/events/"
                + enc(eventId)
                + "/status?request_id="
                + URLEncoder.encode(requestId, StandardCharsets.UTF_8));
    HttpRequest req = HttpRequest.newBuilder().uri(uri).timeout(Duration.ofSeconds(30)).GET().build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() == 404) {
      StatusResponse soft = new StatusResponse();
      soft.requestId = requestId;
      soft.pollAfterSeconds = 2;
      soft.status = "enrolled";
      soft.admitted = false;
      return soft;
    }
    if (res.statusCode() < 200 || res.statusCode() >= 300) {
      throw new IOException("status failed: " + res.statusCode() + " " + res.body());
    }
    return MAPPER.readValue(res.body(), StatusResponse.class);
  }

  private static String enc(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public static final class EnrollRequest {
    @JsonProperty("request_id")
    public String requestId;
    @JsonProperty("session_id")
    public String sessionId;
    @JsonProperty("return_url")
    public String returnUrl;
    @JsonProperty("invite_code")
    public String inviteCode;
    @JsonProperty("turnstile_token")
    public String turnstileToken;
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static final class EnrollResponse {
    @JsonProperty("request_id")
    public String requestId;
    @JsonProperty("session_id")
    public String sessionId;
    public int position;
    public String status;
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static final class StatusResponse {
    @JsonProperty("request_id")
    public String requestId;
    public int position;
    public int serving;
    @JsonProperty("wait_estimate_minutes")
    public double waitEstimateMinutes;
    @JsonProperty("poll_after_seconds")
    public int pollAfterSeconds;
    public String status;
    public boolean admitted;
    @JsonProperty("admit_token")
    public String admitToken;
    @JsonProperty("return_url")
    public String returnUrl;
    @JsonProperty("dress_rehearsal")
    public boolean dressRehearsal;
  }
}
