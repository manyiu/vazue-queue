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
    botProtection?: { mode?: string; turnstileSiteKey?: string; turnstileSecretArn?: string };
    jwtHmacSecret?: string;
  };
};

const CHALLENGE_BOT_MODES = new Set(['challenge_suspicious', 'challenge_always']);

function needsTurnstile(mode: string | undefined): boolean {
  return CHALLENGE_BOT_MODES.has(mode ?? 'off');
}

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
  const bot = (cfg.security as Record<string, unknown> | undefined)?.botProtection as
    | Record<string, unknown>
    | undefined;
  const botMode = typeof bot?.mode === 'string' ? bot.mode : 'off';
  if (needsTurnstile(botMode)) {
    const arn = bot?.turnstileSecretArn;
    if (typeof arn !== 'string' || !arn.trim()) {
      throw new Error(
        'Invalid config: security.botProtection.turnstileSecretArn required when mode is challenge_suspicious or challenge_always (store the Cloudflare secret in Secrets Manager; see docs/deploy/oss-cdk.md)',
      );
    }
    const siteKey = bot?.turnstileSiteKey;
    if (typeof siteKey !== 'string' || !siteKey.trim()) {
      throw new Error(
        'Invalid config: security.botProtection.turnstileSiteKey required when mode uses Turnstile challenges',
      );
    }
  }
}
