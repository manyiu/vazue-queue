import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateQueueCliConfig } from '../src/config.js';
import { estimateOssEventCost } from '../src/cost.js';
import { writeProject } from '../src/scaffold.js';

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

  it('rejects challenge mode without turnstileSecretArn', () => {
    expect(() =>
      validateQueueCliConfig({
        domainName: 'queue.example.com',
        preset: 'standard',
        awsRegion: 'us-east-1',
        security: {
          botProtection: {
            mode: 'challenge_always',
            turnstileSiteKey: '0x4AAAA',
          },
        },
      }),
    ).toThrow(/turnstileSecretArn/);
  });

  it('accepts challenge mode with site key and secret ARN', () => {
    expect(() =>
      validateQueueCliConfig({
        domainName: 'queue.example.com',
        preset: 'standard',
        awsRegion: 'us-east-1',
        security: {
          botProtection: {
            mode: 'challenge_suspicious',
            turnstileSiteKey: '0x4AAAA',
            turnstileSecretArn:
              'arn:aws:secretsmanager:us-east-1:123456789012:secret:turnstile-AbCdEf',
          },
        },
      }),
    ).not.toThrow();
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

describe('writeProject', () => {
  it('writes vazue-queue.config.json and CDK scaffold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vazue-scaffold-'));
    writeProject(dir, {
      domainName: 'queue.example.com',
      preset: 'standard',
      awsRegion: 'us-east-1',
      security: { botProtection: { mode: 'off' } },
      queue: { defaultThroughputPerMinute: 100 },
    });
    const cfgPath = join(dir, 'vazue-queue.config.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    expect(cfg.domainName).toBe('queue.example.com');
    expect(cfg.preset).toBe('standard');
    expect(existsSync(join(dir, 'bin/app.ts'))).toBe(true);
    expect(existsSync(join(dir, 'cdk.json'))).toBe(true);
  });
});
