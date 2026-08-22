/**
 * Attach Vazue Queue's Lambda@Edge gate to a CloudFront distribution you already own.
 *
 * This example:
 * 1. Deploys the waiting-room stack (`standard` + edge connector, no auto origin CF)
 * 2. Creates a stand-in "existing" shop distribution
 * 3. Associates the edge function as viewer-request on that distribution
 *
 * In production, replace the stand-in distribution with your real one by adding
 * `edgeLambdas: [{ functionVersion: queue.edgeProtect!.edgeVersion!, eventType: VIEWER_REQUEST }]`
 * to your default behavior (stack env must be us-east-1).
 */
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { VazueQueue } from '@yiu/queue-cdk';

const JWT_SECRET = process.env.VAZUE_JWT_HMAC_SECRET ?? 'dev-only-hmac-secret-change-me';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'VazueQueueExistingCf', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
});

const queue = new VazueQueue(stack, 'Queue', {
  domainName: 'queue.example.com',
  preset: 'standard',
  awsRegion: 'us-east-1',
  features: { edgeConnector: true },
  security: {
    botProtection: { mode: 'off' },
    jwtHmacSecret: JWT_SECRET,
  },
});

if (!queue.edgeProtect?.edgeVersion) {
  throw new Error(
    'Edge connector asset missing — run scripts/build-edge-connector.sh then re-synth',
  );
}

// Stand-in for "your existing CloudFront in front of checkout".
const shop = new cloudfront.Distribution(stack, 'ExistingShopDistribution', {
  defaultBehavior: {
    origin: new origins.HttpOrigin('shop.example.com', {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    edgeLambdas: [
      {
        functionVersion: queue.edgeProtect.edgeVersion,
        eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
      },
    ],
  },
  comment: 'Example: existing shop CF with Vazue viewer-request gate',
});

new cdk.CfnOutput(stack, 'ShopDistributionDomain', {
  value: shop.distributionDomainName,
  description: 'Point shop.example.com CNAME here after deploy',
});

new cdk.CfnOutput(stack, 'WaitingRoomHint', {
  value: `https://${queue.distribution?.distributionDomainName ?? 'queue.example.com'}`,
  description: 'Waiting room URL baked into edge-config (use domainName DNS in prod)',
});
