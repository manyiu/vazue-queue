import { createHmac, timingSafeEqual } from 'node:crypto';

export type AdmitTokenClaims = {
  /** Visitor request id */
  sub?: string;
  tenant_id?: string;
  event_id?: string;
  request_id?: string;
  return_url?: string;
  exp?: number;
  [key: string]: unknown;
};

function b64urlToBuf(input: string): Buffer {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

/**
 * Verify an HS256 admit JWT at the origin (Node 20+).
 * Use the same secret as `security.jwtHmacSecret` / data-plane signing.
 */
export function verifyAdmitToken(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): AdmitTokenClaims | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string };
  let payload: AdmitTokenClaims;
  try {
    header = JSON.parse(b64urlToBuf(headerB64).toString('utf8')) as { alg?: string };
    payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8')) as AdmitTokenClaims;
  } catch {
    return null;
  }
  if (header.alg && header.alg !== 'HS256') return null;

  const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  let actual: Buffer;
  try {
    actual = b64urlToBuf(sigB64);
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) {
    return null;
  }
  return payload;
}

/** Read `vazue_token` from a Cookie header or query string. */
export function extractAdmitToken(opts: {
  cookieHeader?: string | null;
  cookieName?: string;
  query?: URLSearchParams | Record<string, string> | null;
}): string | undefined {
  const name = opts.cookieName ?? 'vazue_token';
  if (opts.cookieHeader) {
    for (const part of opts.cookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('=') || '');
    }
  }
  if (opts.query) {
    if (opts.query instanceof URLSearchParams) return opts.query.get(name) ?? undefined;
    return opts.query[name];
  }
  return undefined;
}
