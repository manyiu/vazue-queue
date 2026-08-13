import { describe, expect, it } from 'vitest';
import { looksLikeJwt, signHs256Jwt, verifyHs256Jwt } from '../src/handler.js';

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
});
