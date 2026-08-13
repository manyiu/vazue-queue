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
});
