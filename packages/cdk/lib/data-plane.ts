import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { ResolvedConfig } from './config.js';

export interface QueueDataPlaneProps {
  config: ResolvedConfig;
}

/**
 * Core data plane: DynamoDB tables, HTTP API, signing secret, optional SQS enroll buffer.
 * Lambda assets are placeholders until cargo-lambda CI publishes zips into assets/lambda/.
 */
export class QueueDataPlane extends Construct {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly tables: Record<string, dynamodb.Table>;
  public readonly signingSecret: secretsmanager.Secret;
  public readonly enrollQueue?: sqs.Queue;

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

    this.tables = {
      Tenants: this.table('Tenants', 'tenantId', undefined, removal),
      Rooms: this.table('Rooms', 'tenantId', 'roomId', removal),
      Events: this.table('Events', 'tenantId', 'eventId', removal),
      Visitors: this.table('Visitors', 'eventId', 'requestId', removal, true),
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

    const placeholderCode = lambda.Code.fromInline(`
exports.handler = async () => ({
  statusCode: 501,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ error: 'Replace with Rust cargo-lambda artifact' }),
});
`);

    const fnProps: lambda.FunctionProps = {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: placeholderCode,
      memorySize: config.queue.lambdaMemoryMb,
      architecture:
        config.queue.lambdaArchitecture === 'arm64'
          ? lambda.Architecture.ARM_64
          : lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(10),
      environment: {
        VAZUE_DEPLOYMENT_PROFILE: 'oss',
        SIGNING_SECRET_ARN: this.signingSecret.secretArn,
        COUNTER_SHARDS: String(config.queue.counterShards),
        TOKEN_TTL_SECONDS: String(config.queue.tokenTtlSeconds),
        BOT_PROTECTION_MODE: config.security.botProtection.mode ?? 'off',
        VISITORS_TABLE: this.tables.Visitors.tableName,
        COUNTERS_TABLE: this.tables.Counters.tableName,
        EVENTS_TABLE: this.tables.Events.tableName,
      },
    };

    const enrollFn = new lambda.Function(this, 'EnrollFn', fnProps);
    const statusFn = new lambda.Function(this, 'StatusFn', fnProps);
    const admitFn = new lambda.Function(this, 'AdmitFn', {
      ...fnProps,
      functionName: undefined,
    });
    const reaperFn = new lambda.Function(this, 'ServingReaperFn', {
      ...fnProps,
      timeout: cdk.Duration.seconds(60),
    });

    for (const fn of [enrollFn, statusFn, admitFn, reaperFn]) {
      this.signingSecret.grantRead(fn);
      for (const t of Object.values(this.tables)) {
        t.grantReadWriteData(fn);
      }
    }

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
      integration: new integrations.HttpLambdaIntegration('HealthInt', statusFn),
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/enroll',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('EnrollInt', enrollFn),
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/status',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('StatusInt', statusFn),
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/admit',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('AdmitInt', admitFn),
    });

    // Reaper schedule placeholder via EventBridge rule would be added in full preset.
    reaperFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:UpdateItem'],
        resources: [this.tables.Visitors.tableArn, this.tables.Counters.tableArn],
      }),
    );

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
    const table = new dynamodb.Table(this, id, {
      partitionKey: { name: pk, type: dynamodb.AttributeType.STRING },
      sortKey: sk ? { name: sk, type: dynamodb.AttributeType.STRING } : undefined,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removal,
      timeToLiveAttribute: ttl ? 'ttl' : undefined,
    });
    return table;
  }
}
