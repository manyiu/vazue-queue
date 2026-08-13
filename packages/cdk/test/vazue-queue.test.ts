import { describe, expect, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { VazueQueue } from '../lib/vazue-queue.js';
import { resolveConfig, validateConfig, loadAndMergeConfig } from '../lib/config.js';
import { resolveFeatures } from '../lib/presets.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function synthPreset(preset: 'minimal' | 'standard' | 'full') {
  const app = new App();
  const stack = new Stack(app, 'Test');
  new VazueQueue(stack, 'Queue', {
    domainName: 'queue.example.com',
    preset,
    awsRegion: 'us-east-1',
  });
  return Template.fromStack(stack);
}

describe('VazueQueue presets', () => {
  it('minimal has DynamoDB tables and HTTP API, no CloudFront', () => {
    const template = synthPreset('minimal');
    template.resourceCountIs('AWS::DynamoDB::Table', 7);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('AWS::Cognito::UserPool', 0);
  });

  it('standard includes CloudFront status cache policy', () => {
    const template = synthPreset('standard');
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::DynamoDB::Table', 7);
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: 2,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          QueryStringsConfig: Match.objectLike({
            QueryStringBehavior: 'whitelist',
          }),
        }),
      }),
    });
  });

  it('full includes Cognito Hosted UI domain, WAF, admin HTTP API, and admin CloudFront', () => {
    const template = synthPreset('full');
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 2);
    template.resourceCountIs('AWS::CloudFront::Distribution', 2);
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: Match.anyValue(),
    });
  });

  it('schedules serving reaper', () => {
    const template = synthPreset('minimal');
    template.resourceCountIs('AWS::Events::Rule', 1);
  });

  it('visitors table has session GSI', () => {
    const template = synthPreset('minimal');
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'bySession' }),
      ]),
    });
  });

    it('attaches Lambda@Edge viewer-request when origin and jwt secret are set', () => {
      const app = new App();
      const stack = new Stack(app, 'EdgeOrigin', {
        env: { account: '111111111111', region: 'us-east-1' },
      });
      new VazueQueue(stack, 'Queue', {
        domainName: 'queue.example.com',
        preset: 'full',
        awsRegion: 'us-east-1',
        origin: { domainName: 'shop.example.com' },
        security: { jwtHmacSecret: 'test-hmac-secret-16' },
      });
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::CloudFront::Distribution', 3);
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            LambdaFunctionAssociations: Match.arrayWith([
              Match.objectLike({ EventType: 'viewer-request' }),
            ]),
          }),
        }),
      });
    });

    it('enroll buffer enables ENROLL_VIA_SQS on queue Lambdas', () => {
      const template = synthPreset('standard');
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            ENROLL_VIA_SQS: '1',
          }),
        },
      });
      template.resourceCountIs('AWS::SQS::Queue', 1);
    });
  });

describe('config', () => {
  it('rejects missing domainName', () => {
    expect(() => validateConfig({ preset: 'standard' })).toThrow(/domainName/);
  });

  it('resolves defaults', () => {
    const cfg = resolveConfig({ domainName: 'queue.example.com' });
    expect(cfg.preset).toBe('standard');
    expect(cfg.awsRegion).toBe('us-east-1');
    expect(cfg.security.botProtection.mode).toBe('off');
    expect(cfg.queue.counterShards).toBe(8);
    expect(cfg.waitingRoom.brandName).toBe('Vazue Queue');
  });

  it('merges overlays', () => {
    const dir = join(tmpdir(), `vazue-cfg-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, 'base.json');
    const prod = join(dir, 'prod.json');
    writeFileSync(base, JSON.stringify({ domainName: 'queue.example.com', queue: { defaultThroughputPerMinute: 100 } }));
    writeFileSync(prod, JSON.stringify({ queue: { defaultThroughputPerMinute: 500 } }));
    const cfg = loadAndMergeConfig(base, prod);
    expect(cfg.queue?.defaultThroughputPerMinute).toBe(500);
  });
});

describe('presets', () => {
  it('full enables admin and edge connector', () => {
    expect(resolveFeatures('full').adminPortal).toBe(true);
    expect(resolveFeatures('full').edgeConnector).toBe(true);
  });
});

describe('SaaS profile env', () => {
  it('sets VAZUE_DEPLOYMENT_PROFILE=saas when stripe feature enabled', () => {
    const app = new App();
    const stack = new Stack(app, 'SaasProfile');
    new VazueQueue(stack, 'Queue', {
      domainName: 'queue.example.com',
      preset: 'full',
      awsRegion: 'us-east-1',
      features: { stripe: true },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          VAZUE_DEPLOYMENT_PROFILE: 'saas',
        }),
      },
    });
  });
});
