import type {
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
  CloudFrontResponseEvent,
  CloudFrontResponseResult,
} from 'aws-lambda';

export interface EdgeConfig {
  waitingRoomUrl: string;
  /** HS256 shared secret or JWKS URL placeholder for RS256 */
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

/** Minimal HS256 segment check — production should use full JWT verify with jose. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
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

  if (token && looksLikeJwt(token)) {
    // Offline verify would go here (jose / jsonwebtoken).
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
