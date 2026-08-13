import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { resolveConfig, type VazueQueueConfig } from './config.js';
import { QueueDataPlane } from './data-plane.js';

export interface VazueQueueProps extends VazueQueueConfig {}

export class VazueQueue extends Construct {
  public readonly dataPlane: QueueDataPlane;
  public readonly waitingRoomBucket?: s3.Bucket;
  public readonly distribution?: cloudfront.Distribution;
  public readonly userPool?: cognito.UserPool;

  constructor(scope: Construct, id: string, props: VazueQueueProps) {
    super(scope, id);
    const config = resolveConfig(props);
    this.dataPlane = new QueueDataPlane(this, 'DataPlane', { config });

    const removal =
      config.security.removalPolicy === 'retain'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

    if (config.features.waitingRoom) {
      this.waitingRoomBucket = new s3.Bucket(this, 'WaitingRoomBucket', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        removalPolicy: removal,
        autoDeleteObjects: removal === cdk.RemovalPolicy.DESTROY,
      });

      let webAclId: string | undefined;
      if (config.features.waf) {
        const acl = new wafv2.CfnWebACL(this, 'QueueWaf', {
          defaultAction: { allow: {} },
          scope: 'CLOUDFRONT',
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'vazueQueueWaf',
            sampledRequestsEnabled: true,
          },
          rules: [
            {
              name: 'RateLimit',
              priority: 1,
              action: { block: {} },
              statement: {
                rateBasedStatement: {
                  limit: 2000,
                  aggregateKeyType: 'IP',
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'vazueRateLimit',
                sampledRequestsEnabled: true,
              },
            },
          ],
        });
        webAclId = acl.attrArn;
      }

      this.distribution = new cloudfront.Distribution(this, 'WaitingRoomDistribution', {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.waitingRoomBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        additionalBehaviors: {
          '/v1/*': {
            origin: new origins.HttpOrigin(
              cdk.Fn.select(2, cdk.Fn.split('/', this.dataPlane.httpApi.apiEndpoint)),
            ),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          },
        },
        comment: `Vazue Queue waiting room for ${config.domainName}`,
        webAclId,
      });

      new cdk.CfnOutput(this, 'WaitingRoomUrl', {
        value: `https://${this.distribution.distributionDomainName}`,
      });
    }

    if (config.features.adminPortal || config.features.adminApi) {
      this.userPool = new cognito.UserPool(this, 'AdminUserPool', {
        selfSignUpEnabled: false,
        signInAliases: { email: true },
        removalPolicy: removal,
      });
      this.userPool.addClient('AdminSpaClient', {
        authFlows: { userSrp: true },
      });
      new cdk.CfnOutput(this, 'AdminUserPoolId', { value: this.userPool.userPoolId });
    }

    if (config.tags) {
      for (const [k, v] of Object.entries(config.tags)) {
        cdk.Tags.of(this).add(k, v);
      }
    }
  }
}

/** Convenience bootstrap from vazue-queue.config.json / cdk context. */
export class VazueQueueApp {
  static fromContext(app: cdk.App, stackId = 'VazueQueueStack'): cdk.Stack {
    const ctx = (app.node.tryGetContext('vazue-queue') ?? {}) as VazueQueueConfig;
    const stack = new cdk.Stack(app, stackId, {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: ctx.awsRegion ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
      },
    });
    new VazueQueue(stack, 'Queue', ctx);
    return stack;
  }
}
