import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LandingStackProps extends cdk.StackProps {
  /** Public hostname, e.g. queue.vazue.com */
  domainName: string;
  /** Route 53 hosted zone name, e.g. vazue.com */
  hostedZoneName: string;
  /**
   * Optional zone ID. Prefer this in CI so synth does not need Route 53 lookup.
   * Example: Z0123456789ABCDEFGHIJ
   */
  hostedZoneId?: string;
  /** Directory with index.html + styles.css (apps/landing/dist). */
  siteAssetPath: string;
}

/**
 * Marketing landing for queue.vazue.com: S3 origin, CloudFront, ACM (us-east-1), Route 53 alias.
 * Private monorepo stack — not part of @yiu/queue-cdk.
 */
export class LandingStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: LandingStackProps) {
    super(scope, id, props);

    if (!existsSync(props.siteAssetPath)) {
      throw new Error(
        `Landing assets not found at ${props.siteAssetPath}. Run: pnpm --filter @vazue/landing build`,
      );
    }

    const zone = props.hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.hostedZoneName,
        })
      : route53.HostedZone.fromLookup(this, 'Zone', {
          domainName: props.hostedZoneName,
        });

    // CloudFront requires ACM certificates in us-east-1.
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      domainNames: [props.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1),
        },
      ],
      comment: `Vazue Queue marketing — ${props.domainName}`,
    });

    new route53.ARecord(this, 'AliasA', {
      zone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      ),
    });

    new route53.AaaaRecord(this, 'AliasAAAA', {
      zone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      ),
    });

    new s3deploy.BucketDeployment(this, 'Deploy', {
      sources: [s3deploy.Source.asset(props.siteAssetPath)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${props.domainName}`,
    });
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: this.distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
    });
  }
}

/** Resolve apps/landing/dist from this package. */
export function defaultLandingAssetPath(): string {
  return join(__dirname, '..', '..', 'landing', 'dist');
}
