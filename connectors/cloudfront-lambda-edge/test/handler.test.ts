import { describe, expect, it } from 'vitest';
import { looksLikeJwt } from '../src/handler.js';

describe('edge connector', () => {
  it('detects jwt shape', () => {
    expect(looksLikeJwt('a.b.c')).toBe(true);
    expect(looksLikeJwt('nope')).toBe(false);
  });
});
