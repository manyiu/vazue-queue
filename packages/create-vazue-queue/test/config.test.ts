import { describe, expect, it } from 'vitest';
import { validateQueueCliConfig } from '../src/config.js';

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
