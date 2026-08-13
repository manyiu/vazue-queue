import { describe, expect, it } from 'vitest';
import { validateQueueCliConfig } from '../src/config.js';
import { estimateOssEventCost } from '../src/cost.js';

describe('validateQueueCliConfig', () => {
  it('accepts minimal valid config', () => {
    expect(() =>
      validateQueueCliConfig({
        domainName: 'queue.example.com',
        preset: 'standard',
        awsRegion: 'us-east-1',
      }),
    ).not.toThrow();
  });

  it('rejects missing domainName', () => {
    expect(() => validateQueueCliConfig({ preset: 'minimal' })).toThrow(/domainName/);
  });

  it('rejects bad preset', () => {
    expect(() =>
      validateQueueCliConfig({ domainName: 'queue.example.com', preset: 'enterprise' }),
    ).toThrow(/preset/);
  });
});

describe('estimateOssEventCost', () => {
  it('scales with visitors and duration', () => {
    const small = estimateOssEventCost({ visitors: 1_000, durationMinutes: 10, pollSeconds: 5 });
    const large = estimateOssEventCost({ visitors: 100_000, durationMinutes: 60, pollSeconds: 5 });
    expect(small.statusRequests).toBe(1_000 * Math.ceil((10 * 60) / 5));
    expect(large.totalUsd).toBeGreaterThan(small.totalUsd);
    expect(large.totalUsd).toBeGreaterThan(0);
  });
});
