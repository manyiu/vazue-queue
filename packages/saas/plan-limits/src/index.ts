export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface PlanLimits {
  maxCounterShards: number;
  maxThroughputPerMinute: number;
  maxConcurrentVisitors: number;
  customDomain: boolean;
}

export const PLANS: Record<PlanTier, PlanLimits> = {
  free: {
    maxCounterShards: 8,
    maxThroughputPerMinute: 200,
    maxConcurrentVisitors: 10_000,
    customDomain: false,
  },
  pro: {
    maxCounterShards: 32,
    maxThroughputPerMinute: 2000,
    maxConcurrentVisitors: 100_000,
    customDomain: true,
  },
  enterprise: {
    maxCounterShards: 64,
    maxThroughputPerMinute: 10_000,
    maxConcurrentVisitors: 1_000_000,
    customDomain: true,
  },
};

export function assertWithinPlan(
  plan: PlanTier,
  desired: { counterShards?: number; throughputPerMinute?: number },
): void {
  const limits = PLANS[plan];
  if (desired.counterShards != null && desired.counterShards > limits.maxCounterShards) {
    throw new Error(`counterShards exceeds ${plan} plan max ${limits.maxCounterShards}`);
  }
  if (
    desired.throughputPerMinute != null &&
    desired.throughputPerMinute > limits.maxThroughputPerMinute
  ) {
    throw new Error(`throughput exceeds ${plan} plan max ${limits.maxThroughputPerMinute}`);
  }
}
