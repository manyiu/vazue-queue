import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { VazueQueue, type VazueQueueProps } from '@yiu/queue-cdk';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DomainHosts {
  marketing: string;
  admin: string;
  managementApi: string;
  waitTenantPattern: string;
  docs: string;
  status: string;
}

export interface DomainConfigFile {
  hostedZoneName: string;
  productRoot: string;
  env: string;
  hosts: DomainHosts;
  acm: { cloudFrontRegion: string; sans: string[] };
}

export interface VazueSaaSPlatformProps {
  domainConfigPath?: string;
  domainConfig?: DomainConfigFile;
  queue?: VazueQueueProps;
}

/**
 * SaaS overlay: wraps VazueQueue, tenant host patterns, and Stripe metering pipeline.
 * Commercial — never published to npm.
 */
export class VazueSaaSPlatform extends Construct {
  public readonly queue: VazueQueue;
  public readonly domain: DomainConfigFile;
  public readonly usageBus: events.EventBus;

  constructor(scope: Construct, id: string, props: VazueSaaSPlatformProps) {
    super(scope, id);
    this.domain = props.domainConfig
      ?? JSON.parse(readFileSync(props.domainConfigPath!, 'utf8')) as DomainConfigFile;

    this.queue = new VazueQueue(this, 'Core', {
      domainName: this.domain.hosts.marketing,
      preset: 'full',
      awsRegion: 'us-east-1',
      features: { stripe: true, edgeConnector: false },
      ...props.queue,
      tags: {
        product: 'vazue-queue',
        env: this.domain.env,
        ...(props.queue?.tags ?? {}),
      },
    });

    this.usageBus = new events.EventBus(this, 'UsageBus', {
      eventBusName: `vazue-usage-${this.domain.env}`,
    });

    const dataFns = [
      this.queue.dataPlane.enrollFn,
      this.queue.dataPlane.statusFn,
      this.queue.dataPlane.admitFn,
      this.queue.dataPlane.reaperFn,
    ];
    for (const fn of dataFns) {
      fn.addEnvironment('VAZUE_DEPLOYMENT_PROFILE', 'saas');
      fn.addEnvironment('USAGE_BUS_NAME', this.usageBus.eventBusName);
      this.usageBus.grantPutEventsTo(fn);
    }
    if (this.queue.controlPlane) {
      this.queue.controlPlane.adminFn.addEnvironment('VAZUE_DEPLOYMENT_PROFILE', 'saas');
    }

    const archive = new s3.Bucket(this, 'UsageArchive', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(400) }],
    });

    const hoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    archive.grantWrite(hoseRole);

    const hose = new firehose.CfnDeliveryStream(this, 'UsageFirehose', {
      deliveryStreamType: 'DirectPut',
      extendedS3DestinationConfiguration: {
        bucketArn: archive.bucketArn,
        roleArn: hoseRole.roleArn,
        prefix: 'usage/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix: 'errors/',
        bufferingHints: { intervalInSeconds: 60, sizeInMBs: 1 },
      },
    });

    const syncEntry = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'lambda',
      'stripe-meter-sync',
      'index.js',
    );

    const stripeEnv = {
      STRIPE_SECRET_ARN: process.env.STRIPE_SECRET_ARN ?? '',
      USAGE_BUS_NAME: this.usageBus.eventBusName,
      STRIPE_DRY_RUN: process.env.STRIPE_DRY_RUN ?? '0',
    };

    const stripeSync = existsSync(syncEntry)
      ? new NodejsFunction(this, 'StripeMeterSync', {
          entry: syncEntry,
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_24_X,
          timeout: cdk.Duration.seconds(30),
          environment: stripeEnv,
        })
      : new lambda.Function(this, 'StripeMeterSync', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline(
            'exports.handler=async()=>({ok:true,note:"stripe-meter-sync missing"});',
          ),
          timeout: cdk.Duration.seconds(30),
          environment: stripeEnv,
        });

    new events.Rule(this, 'UsageToStripe', {
      eventBus: this.usageBus,
      eventPattern: {
        source: ['vazue.queue'],
        detailType: ['visitor.enrolled', 'token.issued', 'api.request'],
      },
      targets: [new targets.LambdaFunction(stripeSync)],
    });

    new cdk.CfnOutput(this, 'WaitTenantPattern', {
      value: this.domain.hosts.waitTenantPattern,
    });
    new cdk.CfnOutput(this, 'ManagementApiHost', {
      value: this.domain.hosts.managementApi,
    });
    new cdk.CfnOutput(this, 'UsageBusName', {
      value: this.usageBus.eventBusName,
    });
    new cdk.CfnOutput(this, 'UsageFirehoseName', {
      value: hose.ref,
    });

    void cloudfront.Distribution;
  }
}

import { tenantIdFromHost, RESERVED_TENANT_SLUGS } from './routing.js';

export { tenantIdFromHost, RESERVED_TENANT_SLUGS };
