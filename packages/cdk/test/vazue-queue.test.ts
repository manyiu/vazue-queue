import { describe, expect, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { VazueQueue } from '../lib/vazue-queue.js';
import { resolveConfig, validateConfig, loadAndMergeConfig } from '../lib/config.js';
import { resolveFeatures } from '../lib/presets.js';

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

function enrollFnRoleLogicalId(template: Template): string {
  const fns = template.findResources('AWS::Lambda::Function');
  const enroll = Object.entries(fns).find(
    ([id]) => id.includes('EnrollFn') && !id.includes('Worker'),
  );
  const role = enroll![1].Properties?.Role as { 'Fn::GetAtt': [string, string] };
  return role['Fn::GetAtt'][0];
}

function policyActionsForRole(template: Template, roleLogicalId: string): string[] {
  const actions: string[] = [];
  const policies = template.findResources('AWS::IAM::Policy');
  for (const res of Object.values(policies)) {
    const roles = res.Properties?.Roles as Array<{ Ref: string } | { 'Fn::GetAtt': string[] }>;
    if (!roles?.some((r) => ('Ref' in r ? r.Ref : r['Fn::GetAtt'][0]) === roleLogicalId)) {
      continue;
    }
    for (const statement of res.Properties?.PolicyDocument?.Statement ?? []) {
      const action = statement.Action;
      if (typeof action === 'string') actions.push(action);
      else if (Array.isArray(action)) actions.push(...action);
    }
  }
  return actions;
}

describe('VazueQueue presets', () => {
  it('minimal has DynamoDB tables and HTTP API, no CloudFront', () => {
    const template = synthPreset('minimal');
    template.resourceCountIs('AWS::DynamoDB::Table', 4);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('AWS::Cognito::UserPool', 0);
  });

  it('standard includes CloudFront status cache policy', () => {
    const template = synthPreset('standard');
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::DynamoDB::Table', 4);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
    });
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
    template.allResourcesProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
    });
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

    it('buffered EnrollFn omits DynamoDB env and data-plane IAM', () => {
      const template = synthPreset('standard');
      const fns = template.findResources('AWS::Lambda::Function');
      const enroll = Object.entries(fns).find(
        ([id]) => id.includes('EnrollFn') && !id.includes('Worker'),
      );
      expect(enroll).toBeDefined();
      const vars = enroll![1].Properties?.Environment?.Variables ?? {};
      expect(vars.ENROLL_VIA_SQS).toBe('1');
      expect(vars.ENROLL_QUEUE_URL).toBeDefined();
      expect(vars.VISITORS_TABLE).toBeUndefined();
      expect(vars.SIGNING_SECRET_ARN).toBeUndefined();

      const roleId = enrollFnRoleLogicalId(template);
      const actions = policyActionsForRole(template, roleId);
      expect(actions.some((a) => a.startsWith('sqs:'))).toBe(true);
      expect(actions.some((a) => a.startsWith('dynamodb:'))).toBe(false);
      expect(actions.some((a) => a.startsWith('secretsmanager:'))).toBe(false);
    });

    it('buffered EnrollFn loads Turnstile secret when bot protection is enabled', () => {
      const app = new App();
      const stack = new Stack(app, 'TurnstileBuffered');
      new VazueQueue(stack, 'Queue', {
        domainName: 'queue.example.com',
        preset: 'standard',
        awsRegion: 'us-east-1',
        security: {
          botProtection: {
            mode: 'challenge_always',
            turnstileSiteKey: '0x4AAAA-test-site-key',
            turnstileSecretArn:
              'arn:aws:secretsmanager:us-east-1:111111111111:secret:turnstile-AbCdEf',
          },
        },
      });
      const template = Template.fromStack(stack);
      const fns = template.findResources('AWS::Lambda::Function');
      const enroll = Object.entries(fns).find(
        ([id]) => id.includes('EnrollFn') && !id.includes('Worker'),
      );
      expect(enroll).toBeDefined();
      const vars = enroll![1].Properties?.Environment?.Variables ?? {};
      expect(vars.TURNSTILE_SECRET_ARN).toBe(
        'arn:aws:secretsmanager:us-east-1:111111111111:secret:turnstile-AbCdEf',
      );
      expect(vars.BOT_PROTECTION_MODE).toBe('challenge_always');

      const roleId = enrollFnRoleLogicalId(template);
      const actions = policyActionsForRole(template, roleId);
      expect(actions.some((a) => a.startsWith('secretsmanager:GetSecretValue'))).toBe(true);
      expect(actions.some((a) => a.startsWith('dynamodb:'))).toBe(false);
    });

    it('scopes Turnstile secret env to EnrollFn only', () => {
      const app = new App();
      const stack = new Stack(app, 'TurnstileScope');
      new VazueQueue(stack, 'Queue', {
        domainName: 'queue.example.com',
        preset: 'standard',
        awsRegion: 'us-east-1',
        security: {
          botProtection: {
            mode: 'challenge_always',
            turnstileSiteKey: '0x4AAAA-test-site-key',
            turnstileSecretArn:
              'arn:aws:secretsmanager:us-east-1:111111111111:secret:turnstile-AbCdEf',
          },
        },
      });
      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: Match.anyValue(),
        Environment: {
          Variables: Match.objectLike({
            TURNSTILE_SECRET_ARN:
              'arn:aws:secretsmanager:us-east-1:111111111111:secret:turnstile-AbCdEf',
          }),
        },
      });
      const fns = template.findResources('AWS::Lambda::Function');
      const status = Object.entries(fns).find(([id]) => id.includes('StatusFn'));
      expect(status).toBeDefined();
      const statusVars = status![1].Properties?.Environment?.Variables ?? {};
      expect(statusVars.TURNSTILE_SECRET_ARN).toBeUndefined();
    });
  });

describe('config', () => {
  it('rejects missing domainName', () => {
    expect(() => validateConfig({ preset: 'standard' })).toThrow(/domainName/);
  });

  it('rejects challenge mode without turnstileSecretArn', () => {
    expect(() =>
      validateConfig({
        domainName: 'queue.example.com',
        security: {
          botProtection: {
            mode: 'challenge_always',
            turnstileSiteKey: '0x4AAAA',
          },
        },
      }),
    ).toThrow(/turnstileSecretArn/);
  });

  it('resolves defaults', () => {
    const cfg = resolveConfig({ domainName: 'queue.example.com' });
    expect(cfg.preset).toBe('standard');
    expect(cfg.awsRegion).toBe('us-east-1');
    expect(cfg.security.botProtection.mode).toBe('off');
    expect(cfg.queue.counterShards).toBe(8);
    expect(cfg.waitingRoom.brandName).toBe('Vazue Queue');
    expect(cfg.waitingRoom.defaultEventId).toBe('default');
    expect(cfg.waitingRoom.defaultRoomId).toBe('default');
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

  it('rejects removed stripe feature in config schema', () => {
    expect(() =>
      validateConfig({
        domainName: 'queue.example.com',
        features: { stripe: true },
      }),
    ).toThrow(/features\.stripe was removed/);
  });
  it('config schema omits removed inviteOnly bot-protection flag', () => {
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config-schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
      properties?: { security?: { properties?: { botProtection?: { properties?: Record<string, unknown> } } } };
    };
    const botProps = schema.properties?.security?.properties?.botProtection?.properties ?? {};
    expect(botProps).not.toHaveProperty('inviteOnly');
  });
});

describe('OSS-only stack', () => {
  it('provisions only operator tables (no SaaS Tenants/UsageDaily)', () => {
    const template = synthPreset('minimal');
    const tableIds = Object.keys(template.findResources('AWS::DynamoDB::Table'));
    expect(tableIds.some((id) => id.includes('Rooms'))).toBe(true);
    expect(tableIds.some((id) => id.includes('Events'))).toBe(true);
    expect(tableIds.some((id) => id.includes('Tenants'))).toBe(false);
    expect(tableIds.some((id) => id.includes('UsageDaily'))).toBe(false);
  });

  it('provisions four operator tables without Tokens audit table', () => {
    const template = synthPreset('minimal');
    const tableIds = Object.keys(template.findResources('AWS::DynamoDB::Table'));
    expect(tableIds).toHaveLength(4);
    expect(tableIds.some((id) => id.includes('Visitors'))).toBe(true);
    expect(tableIds.some((id) => id.includes('Counters'))).toBe(true);
    expect(tableIds.some((id) => id.includes('Tokens'))).toBe(false);
  });

  it('does not inject TOKENS_TABLE on data-plane Lambdas', () => {
    const template = synthPreset('minimal');
    const fns = Object.values(template.findResources('AWS::Lambda::Function'));
    for (const fn of fns) {
      const env = fn.Properties?.Environment?.Variables ?? {};
      expect(env.TOKENS_TABLE).toBeUndefined();
    }
  });

  it('does not inject VAZUE_DEPLOYMENT_PROFILE on queue Lambdas', () => {
    const template = synthPreset('minimal');
    const fns = Object.values(template.findResources('AWS::Lambda::Function'));
    for (const fn of fns) {
      const env = fn.Properties?.Environment?.Variables ?? {};
      expect(env.VAZUE_DEPLOYMENT_PROFILE).toBeUndefined();
    }
  });

  it('does not expose TENANTS_TABLE on admin Lambda', () => {
    const template = synthPreset('full');
    const fns = template.findResources('AWS::Lambda::Function');
    const admin = Object.entries(fns).find(([id]) => id.includes('AdminApiFn'));
    expect(admin).toBeDefined();
    const env = (admin![1].Properties?.Environment?.Variables ?? {}) as Record<string, string>;
    expect(env.TENANTS_TABLE).toBeUndefined();
    expect(env.VAZUE_DEPLOYMENT_PROFILE).toBeUndefined();
  });
});

describe('presets', () => {
  it('feature flags exclude commercial stripe metering', () => {
    for (const preset of ['minimal', 'standard', 'full'] as const) {
      const features = resolveFeatures(preset);
      expect(Object.keys(features)).not.toContain('stripe');
    }
  });

  it('full enables admin and edge connector', () => {
    expect(resolveFeatures('full').adminPortal).toBe(true);
    expect(resolveFeatures('full').edgeConnector).toBe(true);
  });

  it('standard can enable edgeConnector override', () => {
    expect(resolveFeatures('standard', { edgeConnector: true }).edgeConnector).toBe(true);
  });
});

describe('edge connector', () => {
  it('exports EdgeProtectVersionArn for external CloudFront association', () => {
    const app = new App();
    const stack = new Stack(app, 'EdgeExport');
    const queue = new VazueQueue(stack, 'Queue', {
      domainName: 'queue.example.com',
      preset: 'standard',
      awsRegion: 'us-east-1',
      features: { edgeConnector: true },
      security: {
        botProtection: { mode: 'off' },
        jwtHmacSecret: 'test-hmac-secret-16',
      },
    });
    expect(queue.edgeProtect?.edgeVersion).toBeDefined();
    const template = Template.fromStack(stack);
    // No protected-origin CF when origin.domainName omitted (waiting room CF only).
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    const outputs = Object.values(template.findOutputs('*'));
    expect(
      outputs.some((o) => String((o as { Description?: string }).Description ?? '').includes('Qualified version ARN')),
    ).toBe(true);
  });
});
