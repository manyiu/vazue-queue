import { describe, expect, it } from 'vitest';
import {
  handleViewerRequest,
  looksLikeJwt,
  signHs256Jwt,
  verifyHs256Jwt,
} from '../src/handler.js';
import type { CloudFrontRequestEvent } from 'aws-lambda';

function cfRequest(uri: string, extra?: { cookie?: string; query?: string }): CloudFrontRequestEvent {
  return {
    Records: [
      {
        cf: {
          config: { distributionId: 'D1', distributionDomainName: 'd.cloudfront.net', requestId: 'r1' },
          request: {
            uri,
            method: 'GET',
            querystring: extra?.query ?? '',
            headers: {
              host: [{ key: 'Host', value: 'shop.example.com' }],
              ...(extra?.cookie
                ? { cookie: [{ key: 'Cookie', value: extra.cookie }] }
                : {}),
            },
            clientIp: '1.1.1.1',
          },
        },
      },
    ],
  } as CloudFrontRequestEvent;
}

describe('edge connector', () => {
  it('detects jwt shape', () => {
    expect(looksLikeJwt('a.b.c')).toBe(true);
    expect(looksLikeJwt('nope')).toBe(false);
  });

  it('verifies HS256 signature and exp', () => {
    const secret = 'test-secret';
    const now = 1_700_000_000;
    const good = signHs256Jwt({ sub: 'req-1', exp: now + 60 }, secret);
    expect(verifyHs256Jwt(good, secret, now)).toBe(true);
    expect(verifyHs256Jwt(good, 'wrong', now)).toBe(false);

    const expired = signHs256Jwt({ sub: 'req-1', exp: now - 1 }, secret);
    expect(verifyHs256Jwt(expired, secret, now)).toBe(false);
  });

  it('rejects non-HS256 alg', () => {
    const secret = 'test-secret';
    const token = signHs256Jwt({ sub: 'x', exp: 9_999_999_999 }, secret, {
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(verifyHs256Jwt(token, secret)).toBe(false);
  });

  it('allows public paths and valid admit cookies; redirects otherwise', () => {
    const secret = 'edge-secret';
    const cfg = {
      waitingRoomUrl: 'https://queue.example.com',
      jwtSecret: secret,
      cookieName: 'vazue_token',
      publicPaths: ['/health', '/ready', '/favicon.ico'],
    };
    const health = handleViewerRequest(cfRequest('/health'), cfg);
    expect(health).toHaveProperty('uri', '/health');

    const blocked = handleViewerRequest(cfRequest('/checkout'), cfg);
    expect(blocked).toMatchObject({ status: '302' });
    expect((blocked as { headers: { location: { value: string }[] } }).headers.location[0].value).toContain(
      'returnUrl=',
    );

    const token = signHs256Jwt({ sub: 'v1', exp: Math.floor(Date.now() / 1000) + 600 }, secret);
    const allowed = handleViewerRequest(
      cfRequest('/checkout', { cookie: `vazue_token=${token}` }),
      cfg,
    );
    expect(allowed).toHaveProperty('uri', '/checkout');
  });
});
