import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import type { ResolvedConfig } from './config.js';
import { resolveLambdaCode } from './lambda-code.js';

export interface QueueDataPlaneProps {
  config: ResolvedConfig;
}

/**
 * Core data plane: DynamoDB tables, HTTP API, signing secret, optional SQS enroll buffer,
 * EventBridge serving reaper. Prefers cargo-lambda zips when present under assets/lambda/.
 */
export class QueueDataPlane extends Construct {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly tables: Record<string, dynamodb.Table>;
  public readonly signingSecret: secretsmanager.Secret;
  public readonly enrollQueue?: sqs.Queue;
  public readonly enrollFn: lambda.Function;
  public readonly statusFn: lambda.Function;
  public readonly admitFn: lambda.Function;
  public readonly reaperFn: lambda.Function;

  constructor(scope: Construct, id: string, props: QueueDataPlaneProps) {
    super(scope, id);
    const { config } = props;
    const removal =
      config.security.removalPolicy === 'retain'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

    this.signingSecret = new secretsmanager.Secret(this, 'SigningKey', {
      description: 'Vazue Queue JWT signing key (loaded at Lambda cold start)',
      removalPolicy: removal,
    });

    const visitors = this.table('Visitors', 'eventId', 'requestId', removal, true);
    visitors.addGlobalSecondaryIndex({
      indexName: 'bySession',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.tables = {
      Tenants: this.table('Tenants', 'tenantId', undefined, removal),
      Rooms: this.table('Rooms', 'tenantId', 'roomId', removal),
      Events: this.table('Events', 'tenantId', 'eventId', removal),
      Visitors: visitors,
      Counters: this.table('Counters', 'eventId', 'counterType', removal),
      Tokens: this.table('Tokens', 'eventId', 'tokenId', removal),
      UsageDaily: this.table('UsageDaily', 'tenantId', 'date', removal),
    };

    if (config.features.enrollBuffer) {
      this.enrollQueue = new sqs.Queue(this, 'EnrollBuffer', {
        visibilityTimeout: cdk.Duration.seconds(60),
        retentionPeriod: cdk.Duration.days(1),
        removalPolicy: removal,
      });
    }

    const arch =
      config.queue.lambdaArchitecture === 'arm64'
        ? lambda.Architecture.ARM_64
        : lambda.Architecture.X86_64;

    const commonEnv: Record<string, string> = {
      VAZUE_DEPLOYMENT_PROFILE: 'oss',
      TENANT_ID: 'default',
      SIGNING_SECRET_ARN: this.signingSecret.secretArn,
      COUNTER_SHARDS: String(config.queue.counterShards),
      TOKEN_TTL_SECONDS: String(config.queue.tokenTtlSeconds),
      VISITOR_TTL_HOURS: String(config.queue.visitorRecordTtlHours),
      BOT_PROTECTION_MODE: config.security.botProtection.mode ?? 'off',
      VISITORS_TABLE: this.tables.Visitors.tableName,
      COUNTERS_TABLE: this.tables.Counters.tableName,
      EVENTS_TABLE: this.tables.Events.tableName,
      TOKENS_TABLE: this.tables.Tokens.tableName,
      ROOMS_TABLE: this.tables.Rooms.tableName,
      ENROLL_VIA_SQS: config.features.enrollBuffer ? '1' : '0',
    };
    if (this.enrollQueue) {
      commonEnv.ENROLL_QUEUE_URL = this.enrollQueue.queueUrl;
    }
    if (config.security.botProtection.turnstileSecretArn) {
      commonEnv.TURNSTILE_SECRET_ARN = config.security.botProtection.turnstileSecretArn;
    }

    const mkFn = (id: string, binary: string, timeoutSec = 10) => {
      const asset = resolveLambdaCode(binary);
      return new lambda.Function(this, id, {
        runtime: asset.runtime,
        handler: asset.handler,
        code: asset.code,
        memorySize: config.queue.lambdaMemoryMb,
        architecture: arch,
        timeout: cdk.Duration.seconds(timeoutSec),
        environment: commonEnv,
      });
    };

    this.enrollFn = mkFn('EnrollFn', 'enroll');
    this.statusFn = mkFn('StatusFn', 'status');
    this.admitFn = mkFn('AdmitFn', 'admit');
    this.reaperFn = mkFn('ServingReaperFn', 'serving-reaper', 60);

    const allFns = [this.enrollFn, this.statusFn, this.admitFn, this.reaperFn];
    for (const fn of allFns) {
      this.signingSecret.grantRead(fn);
      for (const t of Object.values(this.tables)) {
        t.grantReadWriteData(fn);
      }
    }

    if (this.enrollQueue) {
      this.enrollQueue.grantSendMessages(this.enrollFn);
      const worker = mkFn('EnrollWorkerFn', 'enroll-worker', 30);
      this.signingSecret.grantRead(worker);
      for (const t of Object.values(this.tables)) {
        t.grantReadWriteData(worker);
      }
      this.enrollQueue.grantConsumeMessages(worker);
      worker.addEventSource(
        new eventsources.SqsEventSource(this.enrollQueue, {
          batchSize: 10,
          reportBatchItemFailures: true,
        }),
      );
    }

    new events.Rule(this, 'ServingReaperSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      description: 'Advance serving counter / expire abandoned visitors',
      targets: [new targets.LambdaFunction(this.reaperFn)],
    });

    this.httpApi = new apigwv2.HttpApi(this, 'QueueHttpApi', {
      apiName: `vazue-queue-${config.domainName.replace(/\./g, '-')}`,
      corsPreflight: {
        allowHeaders: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: config.security.corsAllowedOrigins.length
          ? config.security.corsAllowedOrigins
          : ['*'],
      },
    });

    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('HealthInt', this.statusFn),
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/enroll',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('EnrollInt', this.enrollFn),
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/status',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('StatusInt', this.statusFn),
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/admit',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('AdmitInt', this.admitFn),
    });

    new cdk.CfnOutput(this, 'QueueApiUrl', {
      value: this.httpApi.apiEndpoint,
    });
  }

  private table(
    id: string,
    pk: string,
    sk: string | undefined,
    removal: cdk.RemovalPolicy,
    ttl = false,
  ): dynamodb.Table {
    return new dynamodb.Table(this, id, {
      partitionKey: { name: pk, type: dynamodb.AttributeType.STRING },
      sortKey: sk ? { name: sk, type: dynamodb.AttributeType.STRING } : undefined,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removal,
      timeToLiveAttribute: ttl ? 'ttl' : undefined,
    });
  }
}
