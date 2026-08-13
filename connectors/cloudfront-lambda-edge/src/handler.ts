import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
  CloudFrontResponseEvent,
  CloudFrontResponseResult,
} from 'aws-lambda';

export interface EdgeConfig {
  waitingRoomUrl: string;
  /** HS256 shared secret */
  jwtSecret?: string;
  cookieName?: string;
  publicPaths?: string[];
}

function getConfig(): EdgeConfig {
  // Lambda@Edge: config baked at deploy or loaded from CloudFront KVS in production.
  return {
    waitingRoomUrl: process.env.WAITING_ROOM_URL ?? 'https://queue.example.com/wait',
    jwtSecret: process.env.JWT_HMAC_SECRET ?? 'local-dev-hmac-secret-change-me',
    cookieName: process.env.QUEUE_COOKIE ?? 'vazue_token',
    publicPaths: ['/health', '/favicon.ico'],
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((p) => {
      const [k, ...rest] = p.trim().split('=');
      return [k, decodeURIComponent(rest.join('=') || '')];
    }),
  );
}

function b64urlToBuf(input: string): Buffer {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

/** Minimal HS256 segment check — shape only. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/**
 * Verify HS256 JWT (header.payload.signature) with Node crypto.
 * Checks signature, `exp` when present, and optional `alg` === HS256.
 */
export function verifyHs256Jwt(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!looksLikeJwt(token) || !secret) return false;
  const [headerB64, payloadB64, sigB64] = token.split('.');
  let header: { alg?: string; typ?: string };
  let payload: { exp?: number };
  try {
    header = JSON.parse(b64urlToBuf(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));
  } catch {
    return false;
  }
  if (header.alg && header.alg !== 'HS256') return false;

  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac('sha256', secret).update(data).digest();
  let actual: Buffer;
  try {
    actual = b64urlToBuf(sigB64);
  } catch {
    return false;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) {
    return false;
  }
  return true;
}

/** Build a test HS256 JWT (tests / local only). */
export function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const h = enc(header);
  const p = enc(payload);
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export async function handler(
  event: CloudFrontRequestEvent | CloudFrontResponseEvent,
): Promise<CloudFrontRequestResult | CloudFrontResponseResult> {
  if ('Records' in event && event.Records[0].cf.request) {
    return handleRequest(event as CloudFrontRequestEvent);
  }
  return (event as CloudFrontResponseEvent).Records[0].cf.response;
}

async function handleRequest(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
  const cfg = getConfig();
  const req = event.Records[0].cf.request;
  const uri = req.uri || '/';

  if (cfg.publicPaths?.some((p) => uri === p || uri.startsWith(p + '/'))) {
    return req;
  }

  const cookies = parseCookies(req.headers.cookie?.[0]?.value);
  const q = req.querystring ? new URLSearchParams(req.querystring) : new URLSearchParams();
  const token = cookies[cfg.cookieName ?? 'vazue_token'] || q.get('vazue_token') || '';

  if (token && verifyHs256Jwt(token, cfg.jwtSecret ?? '')) {
    return req;
  }

  const dest = `${cfg.waitingRoomUrl}?returnUrl=${encodeURIComponent(`https://${req.headers.host?.[0]?.value || ''}${uri}`)}`;
  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: dest }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
  };
}
