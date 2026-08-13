/**
 * Rough OSS AWS cost estimate for a single waiting-room event (us-east-1 list prices).
 * Not a quote — owners use this to sanity-check a flash-sale bill before deploy.
 */

export interface CostInputs {
  visitors: number;
  durationMinutes: number;
  /** Admits per minute (throughput). Unused in $ math except to bound poll load. */
  throughputPerMinute?: number;
  /** Average status poll interval in seconds (waiting-room adaptive default ~5). */
  pollSeconds?: number;
}

export interface CostBreakdown {
  visitors: number;
  durationMinutes: number;
  enrollRequests: number;
  statusRequests: number;
  apiGatewayUsd: number;
  lambdaUsd: number;
  dynamoUsd: number;
  cloudFrontUsd: number;
  sqsUsd: number;
  totalUsd: number;
  notes: string[];
}

/** us-east-1 public list prices used for the estimator (HTTP API, Lambda, DDB, CF, SQS). */
export const PRICE = {
  httpApiPerMillion: 1.0,
  lambdaPerMillionInvokes: 0.2,
  lambdaGbSecond: 0.0000133334, // ARM 128 MB ≈ 1/8 GB * $0.0000133334/GB-s * 0.125
  ddbWritePerMillion: 1.25,
  ddbReadPerMillion: 0.25,
  cloudFrontHttpsPer10k: 0.01,
  sqsPerMillion: 0.4,
} as const;

export function estimateOssEventCost(input: CostInputs): CostBreakdown {
  const visitors = Math.max(0, Math.floor(input.visitors));
  const durationMinutes = Math.max(1, input.durationMinutes);
  const pollSeconds = Math.max(1, input.pollSeconds ?? 5);
  const pollsPerVisitor = Math.ceil((durationMinutes * 60) / pollSeconds);
  const enrollRequests = visitors;
  const statusRequests = visitors * pollsPerVisitor;
  const totalHttp = enrollRequests + statusRequests;

  const apiGatewayUsd = (totalHttp / 1_000_000) * PRICE.httpApiPerMillion;
  // 128 MB ARM: enroll ~50ms, status ~20ms
  const enrollGbS = enrollRequests * 0.125 * 0.05;
  const statusGbS = statusRequests * 0.125 * 0.02;
  const lambdaUsd =
    (totalHttp / 1_000_000) * PRICE.lambdaPerMillionInvokes +
    (enrollGbS + statusGbS) * 0.0000133334;
  // enroll ~3 WRU, status ~2 RRU
  const dynamoUsd =
    (enrollRequests * 3) / 1_000_000 * PRICE.ddbWritePerMillion +
    (statusRequests * 2) / 1_000_000 * PRICE.ddbReadPerMillion;
  const cloudFrontUsd = (statusRequests / 10_000) * PRICE.cloudFrontHttpsPer10k;
  const sqsUsd = (enrollRequests / 1_000_000) * PRICE.sqsPerMillion;
  const totalUsd = apiGatewayUsd + lambdaUsd + dynamoUsd + cloudFrontUsd + sqsUsd;

  return {
    visitors,
    durationMinutes,
    enrollRequests,
    statusRequests,
    apiGatewayUsd: round4(apiGatewayUsd),
    lambdaUsd: round4(lambdaUsd),
    dynamoUsd: round4(dynamoUsd),
    cloudFrontUsd: round4(cloudFrontUsd),
    sqsUsd: round4(sqsUsd),
    totalUsd: round4(totalUsd),
    notes: [
      'us-east-1 list prices; excludes WAF, data transfer, CloudWatch, Secrets Manager, NAT.',
      'Status request count assumes every visitor polls the whole window; adaptive polling + CDN cache lower this.',
      'Enroll buffer (SQS) included as one message per enroll.',
    ],
  };
}

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

export function formatCostReport(b: CostBreakdown): string {
  const lines = [
    `Vazue Queue OSS cost estimate (us-east-1, ${b.visitors.toLocaleString()} visitors × ${b.durationMinutes} min)`,
    `  Enrolls: ${b.enrollRequests.toLocaleString()}`,
    `  Status polls (est.): ${b.statusRequests.toLocaleString()}`,
    `  API Gateway:  $${b.apiGatewayUsd.toFixed(2)}`,
    `  Lambda:       $${b.lambdaUsd.toFixed(2)}`,
    `  DynamoDB:     $${b.dynamoUsd.toFixed(2)}`,
    `  CloudFront:   $${b.cloudFrontUsd.toFixed(2)}`,
    `  SQS:          $${b.sqsUsd.toFixed(2)}`,
    `  Total ≈       $${b.totalUsd.toFixed(2)}`,
    ...b.notes.map((n) => `  Note: ${n}`),
  ];
  return lines.join('\n');
}
