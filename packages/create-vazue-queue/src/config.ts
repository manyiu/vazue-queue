/** Shared config validation for create-vazue-queue / vazue-queue CLI. */

export type Preset = 'minimal' | 'standard' | 'full';

export type QueueCliConfig = {
  domainName: string;
  preset: Preset;
  awsRegion: string;
  dns?: { hostedZoneId?: string; hostedZoneName?: string };
  queue?: { defaultThroughputPerMinute?: number };
  waitingRoom?: {
    brandName?: string;
    message?: string;
    logoUrl?: string;
    accentColor?: string;
    backgroundColor?: string;
  };
  origin?: { domainName?: string };
  security?: {
    botProtection?: { mode?: string; turnstileSiteKey?: string };
    jwtHmacSecret?: string;
  };
};

export function validateQueueCliConfig(raw: unknown): asserts raw is QueueCliConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid config: expected object');
  }
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.domainName !== 'string' || cfg.domainName.length < 3) {
    throw new Error('Invalid config: domainName required (minLength 3)');
  }
  if (
    cfg.preset !== undefined &&
    cfg.preset !== 'minimal' &&
    cfg.preset !== 'standard' &&
    cfg.preset !== 'full'
  ) {
    throw new Error('Invalid config: preset must be minimal|standard|full');
  }
}
