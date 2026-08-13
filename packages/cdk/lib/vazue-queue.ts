import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, type VazueQueueConfig } from './config.js';
import { QueueDataPlane } from './data-plane.js';
import { QueueControlPlane } from './control-plane.js';
import { QueueEdgeProtect } from './edge-protect.js';

export interface VazueQueueProps extends VazueQueueConfig {}

export class VazueQueue extends Construct {
  public readonly dataPlane: QueueDataPlane;
  public readonly controlPlane?: QueueControlPlane;
  public readonly waitingRoomBucket?: s3.Bucket;
  public readonly distribution?: cloudfront.Distribution;
  public readonly userPool?: cognito.UserPool;
  public readonly userPoolClient?: cognito.UserPoolClient;

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

      const waitingRoomCandidates = [
        join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'waiting-room'),
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '..',
          'apps',
          'waiting-room',
          'dist',
        ),
      ];
      const waitingRoomDist = waitingRoomCandidates.find((p) => existsSync(p));
      const roomCfg = {
        brandName: config.waitingRoom.brandName,
        message: config.waitingRoom.message,
        logoUrl: config.waitingRoom.logoUrl,
        accent: config.waitingRoom.accentColor,
        background: config.waitingRoom.backgroundColor,
        turnstileSiteKey: config.security.botProtection.turnstileSiteKey,
        botMode: config.security.botProtection.mode,
      };
      const configJs = `window.__VAZUE_CONFIG__=${JSON.stringify(roomCfg)};`;
      if (waitingRoomDist) {
        new s3deploy.BucketDeployment(this, 'WaitingRoomDeploy', {
          sources: [
            s3deploy.Source.asset(waitingRoomDist),
            s3deploy.Source.data('config.js', configJs),
          ],
          destinationBucket: this.waitingRoomBucket,
          distribution: this.distribution,
          distributionPaths: ['/*'],
        });
      } else {
        // Synth-safe placeholder so first deploy still has branding config.
        new s3deploy.BucketDeployment(this, 'WaitingRoomConfigOnly', {
          sources: [
            s3deploy.Source.data(
              'index.html',
              `<!doctype html><html><head><script src="/config.js"></script><title>${config.waitingRoom.brandName}</title></head><body><p>${config.waitingRoom.message}</p><p>Build apps/waiting-room (or scripts/build-waiting-room.sh) and redeploy for the full UI.</p></body></html>`,
            ),
            s3deploy.Source.data('config.js', configJs),
          ],
          destinationBucket: this.waitingRoomBucket,
          distribution: this.distribution,
          distributionPaths: ['/*'],
        });
      }

      new cdk.CfnOutput(this, 'WaitingRoomUrl', {
        value: `https://${this.distribution.distributionDomainName}`,
      });

      if (config.features.edgeConnector) {
        new QueueEdgeProtect(this, 'EdgeProtect', {
          waitingRoomUrl: `https://${this.distribution.distributionDomainName}`,
        });
      }
    }

    if (config.features.adminPortal || config.features.adminApi) {
      this.userPool = new cognito.UserPool(this, 'AdminUserPool', {
        selfSignUpEnabled: false,
        signInAliases: { email: true },
        removalPolicy: removal,
      });

      const domainPrefix = `vazue-${cdk.Names.uniqueId(this).slice(-8).toLowerCase()}`.replace(
        /[^a-z0-9-]/g,
        '',
      );
      const userPoolDomain = this.userPool.addDomain('HostedUi', {
        cognitoDomain: { domainPrefix },
      });

      let adminPortalUrl = 'http://localhost:5174/';
      let adminDist: cloudfront.Distribution | undefined;
      let adminBucket: s3.Bucket | undefined;

      if (config.features.adminPortal) {
        adminBucket = new s3.Bucket(this, 'AdminPortalBucket', {
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          removalPolicy: removal,
          autoDeleteObjects: removal === cdk.RemovalPolicy.DESTROY,
        });
        adminDist = new cloudfront.Distribution(this, 'AdminPortalDistribution', {
          defaultBehavior: {
            origin: origins.S3BucketOrigin.withOriginAccessControl(adminBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
          comment: `Vazue Queue admin for ${config.domainName}`,
        });
        adminPortalUrl = `https://${adminDist.distributionDomainName}/`;
      }

      const callbackUrls = [
        adminPortalUrl,
        'http://localhost:5174/',
        'http://localhost:5174',
      ];

      this.userPoolClient = this.userPool.addClient('AdminSpaClient', {
        authFlows: { userSrp: true, userPassword: true },
        oAuth: {
          flows: { implicitCodeGrant: true },
          scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
          callbackUrls,
          logoutUrls: callbackUrls,
        },
        supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      });

      new cdk.CfnOutput(this, 'AdminUserPoolId', { value: this.userPool.userPoolId });
      new cdk.CfnOutput(this, 'AdminUserPoolClientId', {
        value: this.userPoolClient.userPoolClientId,
      });
      new cdk.CfnOutput(this, 'AdminCognitoDomain', {
        value: `${userPoolDomain.domainName}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
      });
      new cdk.CfnOutput(this, 'AdminCognitoRedirectUri', { value: adminPortalUrl });

      if (config.features.adminApi) {
        this.controlPlane = new QueueControlPlane(this, 'ControlPlane', {
          config,
          userPool: this.userPool,
          userPoolClient: this.userPoolClient,
          tables: this.dataPlane.tables,
          signingSecret: this.dataPlane.signingSecret,
        });
      }

      if (config.features.adminPortal && adminBucket && adminDist) {
        const adminCandidates = [
          join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'admin-portal'),
          join(
            dirname(fileURLToPath(import.meta.url)),
            '..',
            '..',
            '..',
            'apps',
            'admin-portal',
            'out',
          ),
        ];
        const adminOut = adminCandidates.find((p) => existsSync(p));
        const adminCfg = {
          adminApiUrl: this.controlPlane?.httpApi.apiEndpoint ?? '',
          cognitoDomain: `${userPoolDomain.domainName}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
          cognitoClientId: this.userPoolClient.userPoolClientId,
          cognitoRedirectUri: adminPortalUrl,
        };
        const runtimeCfg = `window.__VAZUE_ADMIN_CONFIG__=${JSON.stringify(adminCfg)};`;
        const sources = [s3deploy.Source.data('config.js', runtimeCfg)];
        if (adminOut) {
          sources.unshift(s3deploy.Source.asset(adminOut));
        }
        new s3deploy.BucketDeployment(this, 'AdminPortalDeploy', {
          sources,
          destinationBucket: adminBucket,
          distribution: adminDist,
          distributionPaths: ['/*'],
        });
        new cdk.CfnOutput(this, 'AdminPortalUrl', {
          value: adminPortalUrl.replace(/\/$/, ''),
        });
      }
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
