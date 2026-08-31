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
  /**
   * When true, destroy the site bucket on stack delete (dev/ephemeral only).
   * Default false — retain bucket for production vanity domains.
   */
  ephemeral?: boolean;
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

    // CloudFront custom-domain certs must be in us-east-1; fail fast if mis-regioned.
    if (cdk.Stack.of(this).region !== 'us-east-1') {
      throw new Error(
        `LandingStack must deploy to us-east-1 (CloudFront ACM requirement); got ${cdk.Stack.of(this).region}`,
      );
    }

    if (!existsSync(props.siteAssetPath)) {
      throw new Error(
        `Website assets not found at ${props.siteAssetPath}. Run: pnpm website:build`,
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

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const ephemeral = props.ephemeral === true;
    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: ephemeral ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: ephemeral,
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
      // VitePress pre-renders each route to *.html — no SPA fallback (that breaks /assets/*).
      comment: `Vazue Queue website — ${props.domainName}`,
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

/**
 * Resolve apps/website/.vitepress/dist whether running via ts-node (…/lib) or compiled JS (…/dist/lib).
 */
export function defaultWebsiteAssetPath(): string {
  const candidates = [
    // ts-node: apps/landing-cdk/lib → apps/website/.vitepress/dist
    join(__dirname, '..', '..', 'website', '.vitepress', 'dist'),
    // compiled: apps/landing-cdk/dist/lib → apps/website/.vitepress/dist
    join(__dirname, '..', '..', '..', 'website', '.vitepress', 'dist'),
    // legacy fallback during migration
    join(__dirname, '..', '..', 'landing', 'dist'),
    join(__dirname, '..', '..', '..', 'landing', 'dist'),
  ];
  const found = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!found) {
    throw new Error(
      `Website assets not found (tried ${candidates.join(', ')}). Run: pnpm website:build`,
    );
  }
  return found;
}

/** @deprecated Use defaultWebsiteAssetPath */
export function defaultLandingAssetPath(): string {
  return defaultWebsiteAssetPath();
}
