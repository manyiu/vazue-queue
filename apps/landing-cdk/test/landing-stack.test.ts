import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LandingStack } from '../lib/landing-stack';

describe('LandingStack', () => {
  it('creates CloudFront, ACM, and Route53 aliases for queue.vazue.com', () => {
    const dir = join(tmpdir(), `vazue-landing-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'styles.css'), 'body{}');

    try {
      const app = new cdk.App();
      const stack = new LandingStack(app, 'TestLanding', {
        env: { account: '111111111111', region: 'us-east-1' },
        domainName: 'queue.vazue.com',
        hostedZoneName: 'vazue.com',
        hostedZoneId: 'Z09999999999999999999',
        siteAssetPath: dir,
      });
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::CloudFront::Distribution', 1);
      template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
      template.resourceCountIs('AWS::Route53::RecordSet', 2);
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Aliases: ['queue.vazue.com'],
          DefaultRootObject: 'index.html',
        },
      });
      expect(stack.distribution).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
