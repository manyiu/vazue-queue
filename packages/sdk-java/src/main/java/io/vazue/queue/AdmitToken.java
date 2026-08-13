package io.vazue.queue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;

/** HS256 admit-token helpers (same secret as security.jwtHmacSecret / Lambda@Edge). */
public final class AdmitToken {
  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final Base64.Decoder B64URL = Base64.getUrlDecoder();

  private AdmitToken() {}

  /**
   * Verify an HS256 admit JWT. Returns empty when missing, malformed, expired, or wrong secret.
   */
  public static Optional<Map<String, Object>> verify(String token, String secret, Instant now) {
    if (token == null || token.isEmpty() || secret == null || secret.isEmpty()) {
      return Optional.empty();
    }
    String[] parts = token.split("\\.");
    if (parts.length != 3 || parts[0].isEmpty() || parts[1].isEmpty() || parts[2].isEmpty()) {
      return Optional.empty();
    }
    try {
      Map<String, Object> header =
          MAPPER.readValue(B64URL.decode(pad(parts[0])), new TypeReference<Map<String, Object>>() {});
      Object alg = header.get("alg");
      if (alg != null && !"HS256".equals(alg.toString())) {
        return Optional.empty();
      }
      byte[] expected = hmacSha256(secret, parts[0] + "." + parts[1]);
      byte[] actual = B64URL.decode(pad(parts[2]));
      if (!MessageDigest.isEqual(expected, actual)) {
        return Optional.empty();
      }
      Map<String, Object> claims =
          MAPPER.readValue(B64URL.decode(pad(parts[1])), new TypeReference<Map<String, Object>>() {});
      Object exp = claims.get("exp");
      if (exp instanceof Number) {
        Instant when = now == null ? Instant.now() : now;
        if (when.getEpochSecond() >= ((Number) exp).longValue()) {
          return Optional.empty();
        }
      }
      return Optional.of(claims);
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  /** Read {@code vazue_token} from a Cookie header or query string. */
  public static Optional<String> extract(String cookieHeader, String query) {
    final String name = "vazue_token";
    if (cookieHeader != null) {
      for (String part : cookieHeader.split(";")) {
        String trimmed = part.trim();
        int eq = trimmed.indexOf('=');
        if (eq > 0 && name.equals(trimmed.substring(0, eq))) {
          return Optional.of(java.net.URLDecoder.decode(trimmed.substring(eq + 1), StandardCharsets.UTF_8));
        }
      }
    }
    if (query != null && !query.isEmpty()) {
      for (String part : query.split("&")) {
        int eq = part.indexOf('=');
        if (eq > 0 && name.equals(part.substring(0, eq))) {
          return Optional.of(java.net.URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8));
        }
      }
    }
    return Optional.empty();
  }

  private static byte[] hmacSha256(String secret, String data) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
  }

  private static String pad(String b64url) {
    int rem = b64url.length() % 4;
    if (rem == 0) {
      return b64url;
    }
    return b64url + "====".substring(rem);
  }
}
