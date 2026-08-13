import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureFlags, PresetName } from './presets.js';
import { resolveFeatures } from './presets.js';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config-schema.json');

/** JSON Schema document shipped with the package (for IDE / external validators). */
export function getConfigSchema(): object {
  return JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
}

export interface BotProtectionConfig {
  mode?: 'off' | 'rate_limit_only' | 'challenge_suspicious' | 'challenge_always';
  challengeProvider?: 'turnstile' | 'waf_captcha' | 'recaptcha_v3';
  turnstileSiteKey?: string;
  turnstileSecretArn?: string;
  enrollMaxPerIpPerHour?: number;
  inviteOnly?: boolean;
  wafBotControl?: boolean;
  honeypot?: boolean;
}

export interface VazueQueueConfig {
  domainName: string;
  preset?: PresetName;
  awsRegion?: string;
  dns?: {
    hostedZoneId?: string;
    hostedZoneName?: string;
    createRecords?: boolean;
  };
  features?: Partial<FeatureFlags>;
  queue?: {
    defaultThroughputPerMinute?: number;
    counterShards?: number;
    tokenTtlSeconds?: number;
    visitorRecordTtlHours?: number;
    lambdaMemoryMb?: number;
    lambdaArchitecture?: 'arm64' | 'x86_64';
  };
  security?: {
    removalPolicy?: 'destroy' | 'retain';
    enableDeletionProtection?: boolean;
    corsAllowedOrigins?: string[];
    botProtection?: BotProtectionConfig;
    session?: {
      cookieName?: string;
      idempotentEnroll?: boolean;
    };
    /** HS256 secret shared by data plane and Lambda@Edge (required to attach origin gate). */
    jwtHmacSecret?: string;
  };
  origin?: {
    domainName?: string;
  };
  waitingRoom?: {
    brandName?: string;
    message?: string;
    logoUrl?: string;
    accentColor?: string;
    backgroundColor?: string;
    locales?: string[];
    defaultLocale?: string;
  };
  tags?: Record<string, string>;
}

export interface ResolvedConfig extends VazueQueueConfig {
  preset: PresetName;
  awsRegion: string;
  features: FeatureFlags;
  queue: Required<NonNullable<VazueQueueConfig['queue']>>;
  security: {
    removalPolicy: 'destroy' | 'retain';
    enableDeletionProtection: boolean;
    corsAllowedOrigins: string[];
    botProtection: Required<Pick<BotProtectionConfig, 'mode'>> & BotProtectionConfig;
    session: { cookieName: string; idempotentEnroll: boolean };
    jwtHmacSecret?: string;
  };
  origin?: {
    domainName?: string;
  };
  waitingRoom: {
    brandName: string;
    message: string;
    logoUrl?: string;
    accentColor?: string;
    backgroundColor?: string;
    locales: string[];
    defaultLocale: string;
  };
}

export function validateConfig(raw: unknown): asserts raw is VazueQueueConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid vazue-queue config: expected object');
  }
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.domainName !== 'string' || cfg.domainName.length < 3) {
    throw new Error('Invalid vazue-queue config: domainName is required (minLength 3)');
  }
  if (
    cfg.preset !== undefined &&
    cfg.preset !== 'minimal' &&
    cfg.preset !== 'standard' &&
    cfg.preset !== 'full'
  ) {
    throw new Error('Invalid vazue-queue config: preset must be minimal|standard|full');
  }
  if (cfg.awsRegion !== undefined && typeof cfg.awsRegion !== 'string') {
    throw new Error('Invalid vazue-queue config: awsRegion must be a string');
  }
  if (cfg.queue && typeof cfg.queue === 'object') {
    const q = cfg.queue as Record<string, unknown>;
    if (q.counterShards !== undefined) {
      const n = Number(q.counterShards);
      if (!Number.isFinite(n) || n < 1 || n > 64) {
        throw new Error('Invalid vazue-queue config: queue.counterShards must be 1..64');
      }
    }
  }
}

export function loadAndMergeConfig(...paths: string[]): VazueQueueConfig {
  const merged: Record<string, unknown> = {};
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) continue;
    const part = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    deepMerge(merged, part);
  }
  validateConfig(merged);
  return merged as VazueQueueConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const cur = (target[k] as Record<string, unknown>) ?? {};
      target[k] = deepMerge({ ...cur }, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
  return target;
}

export function resolveConfig(input: VazueQueueConfig): ResolvedConfig {
  validateConfig(input);
  const preset = input.preset ?? 'standard';
  const features = resolveFeatures(preset, input.features);
  return {
    ...input,
    preset,
    awsRegion: input.awsRegion ?? 'us-east-1',
    features,
    queue: {
      defaultThroughputPerMinute: input.queue?.defaultThroughputPerMinute ?? 100,
      counterShards: input.queue?.counterShards ?? 8,
      tokenTtlSeconds: input.queue?.tokenTtlSeconds ?? 3600,
      visitorRecordTtlHours: input.queue?.visitorRecordTtlHours ?? 24,
      lambdaMemoryMb: input.queue?.lambdaMemoryMb ?? 128,
      lambdaArchitecture: input.queue?.lambdaArchitecture ?? 'arm64',
    },
    security: {
      removalPolicy: input.security?.removalPolicy ?? 'destroy',
      enableDeletionProtection: input.security?.enableDeletionProtection ?? false,
      corsAllowedOrigins: input.security?.corsAllowedOrigins ?? [],
      botProtection: {
        mode: input.security?.botProtection?.mode ?? 'off',
        ...input.security?.botProtection,
      },
      session: {
        cookieName: input.security?.session?.cookieName ?? 'vazue_qid',
        idempotentEnroll: input.security?.session?.idempotentEnroll ?? true,
      },
      jwtHmacSecret: input.security?.jwtHmacSecret,
    },
    origin: input.origin,
    waitingRoom: {
      brandName: input.waitingRoom?.brandName ?? 'Vazue Queue',
      message:
        input.waitingRoom?.message ?? "You're in line. Please keep this tab open.",
      logoUrl: input.waitingRoom?.logoUrl,
      accentColor: input.waitingRoom?.accentColor,
      backgroundColor: input.waitingRoom?.backgroundColor,
      locales: input.waitingRoom?.locales ?? ['en'],
      defaultLocale: input.waitingRoom?.defaultLocale ?? 'en',
    },
  };
}
