import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface QueueEdgeProtectProps {
  /** Waiting room URL visitors are redirected to when admit cookie is missing/invalid. */
  waitingRoomUrl: string;
  /** HS256 secret shared with queue data plane signing (or a dedicated edge secret). */
  jwtHmacSecretArn?: string;
}

/**
 * Packages the CloudFront Lambda@Edge connector as a regional Lambda for customers
 * to associate with their origin distribution (viewer-request).
 *
 * True Lambda@Edge replication requires a us-east-1 stack; this construct ships the
 * handler code + env contract so OSS full preset can publish a ready artifact.
 */
export class QueueEdgeProtect extends Construct {
  public readonly function?: lambda.Function;

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

    this.function = new lambda.Function(this, 'EdgeViewerRequest', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(assetPath),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      description: 'Vazue Queue CloudFront viewer-request admit-token gate (attach as Lambda@Edge)',
      environment: {
        WAITING_ROOM_URL: props.waitingRoomUrl,
        QUEUE_COOKIE: 'vazue_token',
      },
    });

    new cdk.CfnOutput(this, 'EdgeProtectFunctionArn', {
      value: this.function.functionArn,
      description:
        'Publish a version and associate as CloudFront viewer-request Lambda@Edge on the protected origin',
    });
  }
}
