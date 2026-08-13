import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import type { ResolvedConfig } from './config.js';
import { resolveLambdaCode } from './lambda-code.js';

export interface QueueControlPlaneProps {
  config: ResolvedConfig;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  tables: Record<string, dynamodb.ITable>;
  signingSecret: secretsmanager.ISecret;
}

/**
 * Management / admin HTTP API (OSS full preset) with Cognito JWT authorizer.
 */
export class QueueControlPlane extends Construct {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly adminFn: lambda.Function;

  constructor(scope: Construct, id: string, props: QueueControlPlaneProps) {
    super(scope, id);
    const { config, userPool, userPoolClient, tables, signingSecret } = props;

    const asset = resolveLambdaCode('admin-api');
    this.adminFn = new lambda.Function(this, 'AdminApiFn', {
      runtime: asset.runtime,
      handler: asset.handler,
      code: asset.code,
      memorySize: Math.max(config.queue.lambdaMemoryMb, 256),
      architecture:
        config.queue.lambdaArchitecture === 'arm64'
          ? lambda.Architecture.ARM_64
          : lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(15),
      environment: {
        VAZUE_DEPLOYMENT_PROFILE: config.features.stripe ? 'saas' : 'oss',
        TENANT_ID: 'default',
        ROOMS_TABLE: tables.Rooms.tableName,
        EVENTS_TABLE: tables.Events.tableName,
        COUNTERS_TABLE: tables.Counters.tableName,
        TENANTS_TABLE: tables.Tenants.tableName,
        SIGNING_SECRET_ARN: signingSecret.secretArn,
      },
    });

    signingSecret.grantRead(this.adminFn);
    for (const t of [tables.Rooms, tables.Events, tables.Tenants, tables.Counters]) {
      t.grantReadWriteData(this.adminFn);
    }

    const issuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${userPool.userPoolId}`;
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer('CognitoJwt', issuer, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    this.httpApi = new apigwv2.HttpApi(this, 'AdminHttpApi', {
      apiName: `vazue-admin-${config.domainName.replace(/\./g, '-')}`,
      corsPreflight: {
        allowHeaders: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: config.security.corsAllowedOrigins.length
          ? config.security.corsAllowedOrigins
          : ['*'],
      },
    });

    const integration = new integrations.HttpLambdaIntegration('AdminInt', this.adminFn);

    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });
    this.httpApi.addRoutes({
      path: '/ready',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });
    this.httpApi.addRoutes({
      path: '/v1/capabilities',
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/v1/rooms',
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/v1/rooms/{roomId}',
      methods: [apigwv2.HttpMethod.PUT],
      integration,
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/v1/events',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}',
      methods: [apigwv2.HttpMethod.PUT],
      integration,
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/stats',
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/v1/events/{eventId}/export',
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });

    new cdk.CfnOutput(this, 'AdminApiUrl', {
      value: this.httpApi.apiEndpoint,
    });
  }
}
