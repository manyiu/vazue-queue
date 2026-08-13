import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export interface QueueEdgeProtectProps {
  /** Waiting room URL visitors are redirected to when admit cookie is missing/invalid. */
  waitingRoomUrl: string;
  /**
   * HS256 secret baked into the edge bundle (Lambda@Edge viewer-request cannot use env vars
   * or a multi-MB AWS SDK). Must match the data-plane signing secret.
   */
  jwtHmacSecret?: string;
  cookieName?: string;
  publicPaths?: string[];
  /** When set, create a CloudFront distribution in front of this origin and attach viewer-request. */
  originDomainName?: string;
}

/**
 * CloudFront Lambda@Edge viewer-request admit-token gate.
 *
 * Config is baked into `edge-config.js` beside the handler (no environment variables).
 * When `originDomainName` is set, a protected-origin distribution is created with the
 * association already attached. Otherwise the function version ARN is exported for
 * association on an existing customer distribution.
 */
export class QueueEdgeProtect extends Construct {
  public readonly function?: lambda.Function | cloudfront.experimental.EdgeFunction;
  public readonly protectedDistribution?: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: QueueEdgeProtectProps) {
    super(scope, id);

    const candidates = [
      join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'edge-cloudfront'),
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'connectors',
        'cloudfront-lambda-edge',
        'dist',
      ),
    ];
    const assetPath = candidates.find((p) => existsSync(join(p, 'handler.js')));
    if (!assetPath) {
      new cdk.CfnOutput(this, 'EdgeConnectorNote', {
        value:
          'Build connectors/cloudfront-lambda-edge (or scripts/build-edge-connector.sh) to ship edge protect Lambda code',
      });
      return;
    }

    const staged = join(tmpdir(), `vazue-edge-${cdk.Names.uniqueId(this)}`);
    mkdirSync(staged, { recursive: true });
    cpSync(assetPath, staged, { recursive: true });
    writeFileSync(
      join(staged, 'edge-config.js'),
      `module.exports = ${JSON.stringify({
        waitingRoomUrl: props.waitingRoomUrl,
        jwtSecret: props.jwtHmacSecret ?? '',
        cookieName: props.cookieName ?? 'vazue_token',
        publicPaths: props.publicPaths ?? ['/health', '/ready', '/favicon.ico'],
      })};\n`,
    );

    const stack = cdk.Stack.of(this);
    const envResolved =
      !cdk.Token.isUnresolved(stack.account) && !cdk.Token.isUnresolved(stack.region);

    if (envResolved) {
      this.function = new cloudfront.experimental.EdgeFunction(this, 'EdgeViewerRequest', {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'handler.handler',
        code: lambda.Code.fromAsset(staged),
        memorySize: 128,
        timeout: cdk.Duration.seconds(5),
        description: 'Vazue Queue CloudFront viewer-request admit-token gate',
      });
    } else {
      // Env-agnostic synth (unit tests without account/region): regional placeholder.
      this.function = new lambda.Function(this, 'EdgeViewerRequest', {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'handler.handler',
        code: lambda.Code.fromAsset(staged),
        memorySize: 128,
        timeout: cdk.Duration.seconds(5),
        description:
          'Vazue Queue edge handler (set stack env to us-east-1 to publish as Lambda@Edge)',
      });
    }

    if (!this.function) {
      return;
    }

    if (props.originDomainName) {
      if (!props.jwtHmacSecret) {
        throw new Error(
          'security.jwtHmacSecret is required when origin.domainName is set so the edge gate can verify admit tokens',
        );
      }
      this.protectedDistribution = new cloudfront.Distribution(this, 'ProtectedOrigin', {
        defaultBehavior: {
          origin: new origins.HttpOrigin(props.originDomainName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          edgeLambdas: [
            {
              functionVersion: this.function.currentVersion,
              eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
            },
          ],
        },
        comment: `Vazue Queue origin gate for ${props.originDomainName}`,
      });
      new cdk.CfnOutput(this, 'ProtectedOriginUrl', {
        value: `https://${this.protectedDistribution.distributionDomainName}`,
        description: 'Point DNS for the protected site here (admit cookie required)',
      });
    }

    new cdk.CfnOutput(this, 'EdgeProtectFunctionArn', {
      value: this.function.functionArn,
      description:
        'Associate as CloudFront viewer-request on the protected origin if origin.domainName was omitted.',
    });
  }
}
