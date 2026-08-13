import { describe, expect, it } from 'vitest';
import { assertWithinPlan } from '../src/index.js';

describe('plan limits', () => {
  it('allows free tier within caps', () => {
    expect(() => assertWithinPlan('free', { counterShards: 8, throughputPerMinute: 100 })).not.toThrow();
  });
  it('rejects over free cap', () => {
    expect(() => assertWithinPlan('free', { counterShards: 16 })).toThrow(/exceeds/);
  });
});
