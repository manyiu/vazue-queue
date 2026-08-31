import { describe, expect, it } from 'vitest';

describe('waiting-room config helpers', () => {
  it('needs turnstile only for challenge modes with site key', () => {
    const needs = (botMode: string, turnstileSiteKey?: string) =>
      Boolean(turnstileSiteKey) &&
      (botMode === 'challenge_always' || botMode === 'challenge_suspicious');
    expect(needs('off', 'key')).toBe(false);
    expect(needs('challenge_always', 'key')).toBe(true);
    expect(needs('challenge_always')).toBe(false);
  });

  it('prefers same-origin API on deployed hosts', () => {
    const apiBase = (hostname: string, configApiBase?: string) => {
      if (configApiBase !== undefined) return configApiBase;
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
      return isLocal ? 'http://localhost:3000' : '';
    };
    expect(apiBase('queue.example.com', '')).toBe('');
    expect(apiBase('localhost')).toBe('http://localhost:3000');
  });

  it('resolves event id in priority order', () => {
    const resolve = (query?: string, active?: string, configured?: string, localDemo?: string) =>
      query ?? active ?? configured ?? localDemo ?? 'missing';
    expect(resolve(undefined, 'live', 'default', 'demo')).toBe('live');
    expect(resolve(undefined, undefined, 'default', 'demo')).toBe('default');
    expect(resolve(undefined, undefined, undefined, 'demo')).toBe('demo');
  });
});
