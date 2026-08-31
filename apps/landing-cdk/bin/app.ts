#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LandingStack, defaultWebsiteAssetPath } from '../lib/landing-stack';

const app = new cdk.App();

const domainName =
  (app.node.tryGetContext('domainName') as string | undefined) ?? 'queue.vazue.com';
const hostedZoneName =
  (app.node.tryGetContext('hostedZoneName') as string | undefined) ?? 'vazue.com';
const hostedZoneId =
  (app.node.tryGetContext('hostedZoneId') as string | undefined) ??
  process.env.HOSTED_ZONE_ID;

// CloudFront + ACM for custom domains must live in us-east-1.
new LandingStack(app, 'VazueQueueLanding', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Product website for queue.vazue.com (marketing + docs)',
  domainName,
  hostedZoneName,
  hostedZoneId: hostedZoneId || undefined,
  siteAssetPath: defaultWebsiteAssetPath(),
  tags: {
    product: 'vazue-queue',
    component: 'website',
  },
});

app.synth();
